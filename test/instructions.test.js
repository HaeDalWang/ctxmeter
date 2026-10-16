const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { claudeInstructions, codexInstructions, kiroInstructions, importsOf } = require('../src/instructions');

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-instr-')));
  const home = path.join(root, 'home');
  const workspace = path.join(home, 'work', 'repo', 'pkg');
  fs.mkdirSync(workspace, { recursive: true });
  return { root, home, workspace };
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

const names = (result) => result.files.map((file) => path.basename(file.path));

test('imports are found outside code, resolved from the importing file, and literal mentions are ignored', () => {
  const text = [
    'See @docs/guide.md and @~/shared.md.',
    'Not this: `@README` or user@example.com',
    '```',
    '@inside-fence.md',
    '```',
    '@Design\\ Docs/x.md',
  ].join('\n');
  assert.deepEqual(importsOf(text), ['docs/guide.md', '~/shared.md', 'Design Docs/x.md']);
});

test('Claude loads user, ancestor, project, and local files, with their imports', () => {
  const { home, workspace } = fixture();
  write(path.join(home, '.claude/CLAUDE.md'), 'user\n@~/notes/shared.md\n');
  write(path.join(home, 'notes/shared.md'), 'shared');
  write(path.join(home, 'work/CLAUDE.md'), 'ancestor');
  write(path.join(workspace, 'CLAUDE.md'), 'project\n@docs/a.md\n');
  write(path.join(workspace, 'docs/a.md'), 'A\n@b.md');
  write(path.join(workspace, 'docs/b.md'), 'B');
  write(path.join(workspace, '.claude/CLAUDE.md'), 'dot');
  write(path.join(workspace, 'CLAUDE.local.md'), 'local');
  write(path.join(workspace, 'sub/CLAUDE.md'), 'subdirectory: loads on demand, not at launch');

  const result = claudeInstructions(home, workspace);

  assert.deepEqual(names(result).sort(), ['CLAUDE.local.md', 'CLAUDE.md', 'CLAUDE.md', 'CLAUDE.md', 'CLAUDE.md', 'a.md', 'b.md', 'shared.md'].sort());
  assert.equal(result.files.filter((file) => file.scope === 'import').length, 3);
  assert.ok(!result.files.some((file) => file.path.includes(`${path.sep}sub${path.sep}`)));
});

test('Claude imports stop after four hops and never count a file twice', () => {
  const { home, workspace } = fixture();
  write(path.join(workspace, 'CLAUDE.md'), '@1.md');
  for (let hop = 1; hop <= 6; hop += 1) write(path.join(workspace, `${hop}.md`), `@${hop + 1}.md\n@CLAUDE.md`);

  const result = claudeInstructions(home, workspace);

  assert.deepEqual(names(result).sort(), ['1.md', '2.md', '3.md', '4.md', 'CLAUDE.md']);
});

test('Claude rules with paths frontmatter load on demand and are not counted', () => {
  const { home, workspace } = fixture();
  write(path.join(home, '.claude/rules/always.md'), 'always');
  write(path.join(workspace, '.claude/rules/nested/project.md'), 'project rule');
  write(path.join(workspace, '.claude/rules/scoped.md'), '---\npaths: ["**/*.ts"]\n---\nscoped');

  const result = claudeInstructions(home, workspace);

  assert.deepEqual(names(result).sort(), ['always.md', 'project.md']);
  assert.equal(result.onDemand, 1);
});

test('Claude reads AGENTS.md only when no CLAUDE.md is in the workspace or above it', () => {
  const { home, workspace } = fixture();
  write(path.join(home, '.claude/CLAUDE.md'), 'user file does not count for the check');
  write(path.join(workspace, 'AGENTS.md'), 'agents');
  assert.deepEqual(names(claudeInstructions(home, workspace)).sort(), ['AGENTS.md', 'CLAUDE.md']);

  write(path.join(workspace, 'CLAUDE.local.md'), 'local');
  assert.deepEqual(names(claudeInstructions(home, workspace)).sort(), ['CLAUDE.local.md', 'CLAUDE.md']);
});

test('a CLAUDE.md symlinked to AGENTS.md is counted once', () => {
  const { home, workspace } = fixture();
  write(path.join(workspace, 'AGENTS.md'), 'shared');
  fs.symlinkSync(path.join(workspace, 'AGENTS.md'), path.join(workspace, 'CLAUDE.md'));
  write(path.join(workspace, 'X.md'), '@AGENTS.md');
  assert.equal(claudeInstructions(home, workspace).files.length, 1);
});

test('Codex walks from the git root to the workspace, one file per directory, override first', () => {
  const { home, workspace } = fixture();
  const repo = path.dirname(workspace);
  fs.mkdirSync(path.join(repo, '.git'));
  write(path.join(home, 'work/AGENTS.md'), 'above the git root: not read');
  write(path.join(repo, 'AGENTS.md'), 'root');
  write(path.join(workspace, 'AGENTS.md'), 'ignored because of the override');
  write(path.join(workspace, 'AGENTS.override.md'), 'override');
  write(path.join(home, '.codex/AGENTS.md'), 'global');

  const result = codexInstructions(home, workspace);

  assert.deepEqual(result.files.map((file) => path.relative(home, file.path)), ['.codex/AGENTS.md', 'work/repo/AGENTS.md', 'work/repo/pkg/AGENTS.override.md']);
});

test('Codex stops adding project files at project_doc_max_bytes and honours fallback names', () => {
  const { home, workspace } = fixture();
  write(path.join(home, '.codex/config.toml'), 'project_doc_max_bytes = 100\nproject_doc_fallback_filenames = ["TEAM.md"]\n');
  write(path.join(path.dirname(workspace), 'TEAM.md'), 'x'.repeat(80));
  write(path.join(workspace, 'AGENTS.md'), 'y'.repeat(80));
  fs.mkdirSync(path.join(path.dirname(workspace), '.git'));

  const result = codexInstructions(home, workspace);

  assert.deepEqual(result.files.map((file) => [path.basename(file.path), file.bytes]), [['TEAM.md', 80], ['AGENTS.md', 20]]);
  assert.equal(result.truncated, true);
});

test('Codex without a git root reads only the workspace itself', () => {
  const { home, workspace } = fixture();
  write(path.join(path.dirname(workspace), 'AGENTS.md'), 'parent');
  write(path.join(workspace, 'AGENTS.md'), 'here');
  assert.deepEqual(codexInstructions(home, workspace).files.map((file) => path.relative(workspace, file.path)), ['AGENTS.md']);
});

test('Kiro counts always-included steering, global and workspace, plus AGENTS.md', () => {
  const { home, workspace } = fixture();
  write(path.join(home, '.kiro/steering/style.md'), 'no front matter: always');
  write(path.join(home, '.kiro/steering/manual.md'), '---\ninclusion: manual\n---\nmanual');
  write(path.join(workspace, '.kiro/steering/tech.md'), '---\ninclusion: always\n---\ntech');
  write(path.join(workspace, '.kiro/steering/tsx.md'), '---\ninclusion: fileMatch\nfileMatchPattern: "**/*.tsx"\n---\n');
  write(path.join(workspace, '.kiro/steering/api.md'), '---\ninclusion: auto\nname: api\ndescription: d\n---\n');
  write(path.join(workspace, 'AGENTS.md'), '---\ninclusion: manual\n---\nAGENTS.md ignores inclusion modes');

  const result = kiroInstructions(home, workspace);

  assert.deepEqual(names(result).sort(), ['AGENTS.md', 'style.md', 'tech.md']);
  assert.equal(result.onDemand, 3);
});

test('the audit counts workspace instructions, not just the global file', () => {
  const { scanEnvironment } = require('../src/scanner');
  const { auditReport } = require('../src/audit');
  const { home, workspace } = fixture();
  write(path.join(home, '.claude/CLAUDE.md'), 'u'.repeat(400));
  write(path.join(workspace, 'CLAUDE.md'), `${'p'.repeat(800)}\n@docs/x.md\n`);
  write(path.join(workspace, 'docs/x.md'), 'x'.repeat(1_200));
  write(path.join(workspace, '.kiro/steering/a.md'), 'k'.repeat(2_000));

  const report = auditReport(scanEnvironment({ home, workspace }));
  const finding = (id) => report.harnesses.find((harness) => harness.id === id).findings.find((item) => item.id === 'instructions');

  assert.equal(finding('claude').tokens, Math.round((400 + 812 + 1_200) / 4));
  assert.equal(finding('claude').detail, '3 files: user CLAUDE.md, project 1, imports 1');
  assert.equal(finding('kiro').tokens, 500);
});
