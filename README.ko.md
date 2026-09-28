<h1 align="center">ctxmeter</h1>

<p align="center"><a href="README.md">English</a> · <b>한국어</b></p>

<p align="center"><b>AI 코딩 에이전트는 글자 하나 입력하기도 전에 토큰 수만 개를 씁니다.<br/>얼마나, 어디에 썼는지 보여주고, 고른 항목을 꺼 줍니다.</b></p>

<p align="center">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-6e5aff?style=flat-square"></a>
  <img alt="Node 20+" src="https://img.shields.io/badge/node-20%2B-1f9d55?style=flat-square">
  <img alt="no telemetry" src="https://img.shields.io/badge/telemetry-none-0a0a0c?style=flat-square">
  <img alt="Claude Code, Codex, Kiro" src="https://img.shields.io/badge/agents-Claude%20Code%20%7C%20Codex%20%7C%20Kiro-2ec7b6?style=flat-square">
</p>

```bash
npx github:HaeDalWang/ctxmeter
```

<p align="center"><img src="docs/demo.gif" alt="Kiro, Claude Code, Codex의 시작 비용 33,458 토큰을 보여주는 ctxmeter audit 출력" width="760"></p>

스킬, 규칙 파일, steering 문서, 훅, MCP 서버는 모두 세션 시작 때 로드됩니다. 보통은 컴팩션이 터지고 나서야 알게 됩니다. 명령 하나, 설정 없음, 계정 없음, 아무것도 밖으로 나가지 않습니다.

## 빠른 시작

ctxmeter는 npm에 없습니다. `npx github:HaeDalWang/ctxmeter`로 이 저장소에서 바로 실행합니다(Node 20+). 아래의 `ctxmeter`는 이 명령, 또는 클론한 폴더 안의 `node src/cli.js`를 뜻합니다.

```bash
# 1. 지금 내 설정이 얼마나 먹고 있나?
npx github:HaeDalWang/ctxmeter

# 2. MCP 도구 스키마까지 포함 — 가장 크고 가장 안 보이는 비용.
#    서버를 실제로 띄우므로 명시적으로 켜야 합니다. 먼저 무엇을 띄울지 확인:
ctxmeter mcp-scan --dry-run
ctxmeter mcp-scan --i-understand-this-launches-servers

# 3. 비싼 것부터 끄기. 먼저 dry run; --disable은 백업하고 되돌리는 명령을 출력합니다.
ctxmeter fix
ctxmeter fix --disable codex/code-review-graph   # --enable로 다시 켜기

# 나머지
ctxmeter --help
```

### 메뉴바 앱 (macOS 14+)

```bash
xcode-select --install     # Swift 커맨드라인 도구; 이미 있으면 생략
brew install node          # node 20+가 이미 있으면 생략
git clone https://github.com/HaeDalWang/ctxmeter.git && cd ctxmeter
./scripts/ctxmeter-bar.sh install
```

1. `/Applications/CtxmeterBar.app`을 터미널이 아니라 **Finder**에서 엽니다(아래 참고).
2. 시스템 설정 → 메뉴 막대 → **CtxmeterBar** 켜기.
3. 업그레이드는 `git pull && ./scripts/ctxmeter-bar.sh install`. 새 릴리즈가 나오면 팝오버에 알림이 뜹니다.

**실행 중인데 아이콘이 안 보이면 (macOS 26)?** 토글을 켜도 Control Center가 앱을 계속 막아 두거나, 앱을 띄운 (꺼져 있는) 터미널 밑으로 분류해 버릴 수 있습니다. `./scripts/menubar-allowlist.py`로 상태를 보고 `--repair`로 고칩니다. 백업을 남기고 되돌리는 명령도 출력합니다. 터미널에 전체 디스크 접근 권한이 필요합니다. [원인](develop/execution/08-menubar-management.md).

측정하고, 그다음 조치. 같은 숫자를 두 곳에서 봅니다: 한 번에 점검하고 끄는 CLI, 그리고 턴별 컨텍스트를 그래프로 보여주고 항목을 켜고 끄는 메뉴바 앱.

## 이런 분께

**예상보다 일찍 컴팩션이 옵니다.** 실제 보고 사례: [첫 메시지 전에 윈도우의 20%가 사라짐](https://github.com/anthropics/claude-code/issues/50133), [새 세션 "hello"에 50k+ 토큰](https://github.com/anthropics/claude-code/issues/84490), [`/clear` 직후 83.3k 토큰](https://www.reddit.com/r/ClaudeCode/comments/1mwxfit/), [MCP 서버 하나가 125,964 토큰](https://github.com/anthropics/claude-code/issues/12241). 첫 단계는 어떤 파일과 서버가 원인인지 찾는 것입니다.

**플러그인 번들을 깔고 잊어버렸습니다.** 스킬 그룹 하나에 스킬이 수백 개 들어 있을 수 있고, 각각의 frontmatter가 시작 때 로드됩니다. ctxmeter는 순위를 매겨 가장 큰 것을 첫 줄에 보여줍니다.

**에이전트를 여러 개 씁니다.** Claude Code, Codex, Kiro는 스킬·규칙·훅·MCP 설정을 각자 다른 구조로 둡니다. 셋을 모두 읽어 나란히 보여주는 도구는 이것뿐입니다.

## 아무도 재지 않는 MCP 측정

MCP 도구 스키마는 보고된 비용 중 가장 크고, **실제 프롬프트 안에만** 존재합니다 — 로컬 파일 어디에도 없습니다. 그래서 정직하게 재려면 각 서버를 띄워서 물어봐야 합니다.

읽기 전용 약속과 충돌하므로 명시적 플래그가 필요한 별도 명령입니다.

```bash
ctxmeter mcp-scan --dry-run     # 무엇을 띄울지 정확히, 환경변수는 이름만
ctxmeter mcp-scan --i-understand-this-launches-servers
```

```
MCP tool schemas cost 17,877 tokens across 78 tools.

  codex/code-review-graph: 7,298 tokens, 30 tools
  kiro/playwright: 4,352 tokens, 25 tools
  kiro/aws-mcp: 2,892 tokens, 8 tools
  kiro/context7: 1,148 tokens, 2 tools
  codex/shadcn: 1,124 tokens, 7 tools
  codex/node_repl: 541 tokens, 4 tools
  kiro/exa: 522 tokens, 2 tools
```

서버별 타임아웃과 강제 종료, 원격 서버는 명시하지 않으면 건너뜀, 스키마는 개수를 센 뒤 버립니다. 꺼 둔 서버는 절대 띄우지 않습니다. 결과는 캐시되어 `ctxmeter` 점검에 합쳐집니다.

## 그다음, 비싼 것 끄기

숫자를 아는 건 절반입니다. `fix`는 각 항목을 편집 한 번으로 바꿉니다. 모든 에이전트에 이미 끄는 플래그가 있으므로 편집은 항상 키 하나입니다.

```bash
ctxmeter fix                                  # dry run, 아무것도 바꾸지 않음
ctxmeter fix --disable codex/code-review-graph  # 한 번에 하나씩
```

```
20,747 tokens sit behind 12 switches you can flip.

     7,298  codex/code-review-graph, 30 tools
            [mcp_servers.code-review-graph] in ~/.codex/config.toml
     4,352  kiro/playwright, 25 tools
            "playwright" in ~/.kiro/settings/mcp.json
     2,892  kiro/aws-mcp, 8 tools
            "aws-mcp" in ~/.kiro/settings/mcp.json
     1,890  claude/plugin:aws-core@agent-toolkit-for-aws, 13 skills
            "aws-core@agent-toolkit-for-aws" in ~/.claude/settings.json
       ...

Nothing has been changed. To switch one off:
  ctxmeter fix --disable codex/code-review-graph
```

Claude 플러그인은 `~/.claude/settings.json`의 `enabledPlugins`로 켜고 끕니다. Claude MCP 서버는 대상 대신 `/mcp` 안내로 표시됩니다. 끄는 스위치가 `~/.claude.json`에 있는데, Claude가 실행 중에 이 파일을 다시 쓰기 때문에 ctxmeter는 건드리지 않습니다.

적용하면 원본 옆에 백업을 쓰고 되돌리는 명령을 출력합니다.

```
Switched off codex/code-review-graph, freeing about 7,298 tokens at startup.

  changed  ~/.codex/config.toml
  backup   ~/.codex/config.toml.ctxmeter-2026-09-24T13-43-48-623Z.bak

To undo:
  cp '~/.codex/config.toml.ctxmeter-2026-09-24T13-43-48-623Z.bak' '~/.codex/config.toml'
```

TOML은 줄 단위로 편집하고 다시 직렬화하지 않으므로 주석과 나머지 78개 섹션은 바이트 그대로 남습니다. JSON은 다시 직렬화하지만, 키 순서와 편집이 보존되는지 왕복 검증을 통과한 경우에만 씁니다. 파싱되지 않는 파일은 고치지 않고 거부합니다. 일괄 적용도 되돌리기 로그도 없습니다 — 출력된 `cp`는 ctxmeter를 지운 뒤에도 동작합니다.

**당신이 쓴 글은 건드리지 않습니다.** `CLAUDE.md`, `AGENTS.md`, 규칙 파일, steering 문서는 보고만 하고 편집하지 않습니다. MCP 서버를 끄는 건 설정이지만, 규칙 파일을 옮기는 건 당신의 작업을 고치는 일입니다.

## macOS 메뉴바 앱

메뉴바에 아이콘 하나와 숫자 하나: 지켜보는 에이전트의 컨텍스트 윈도우가 얼마나 찼는지, 30초마다 갱신합니다.

<p align="center">
  <img src="docs/img/menubar-overview.png" alt="메뉴바 팝오버 Overview 탭: Claude Code, Codex, Kiro의 컨텍스트 점유율과 턴별 그래프" width="300">
  <img src="docs/img/menubar-session.png" alt="메뉴바 팝오버 Claude 탭: 현재 세션 최고 274k, 컴팩션 1회 표시, 최근 7일 가장 큰 세션" width="300">
</p>
<p align="center"><img src="docs/img/menubar-details.png" alt="Details 창: Claude Code 컨텍스트 윈도우 구성과 시작 시 로드되는 항목을 비용순으로, 켜기/끄기 스위치와 함께" width="760"></p>

- **팝오버:** 에이전트별 현재 세션의 턴별 컨텍스트, 컴팩션 표시. 막대에 마우스를 올리면 그 턴의 값이 보입니다. 에이전트 탭에는 최근 7일 가장 큰 세션이 추가됩니다.
- **Details:** 윈도우가 무엇으로 채워졌는지 — 지침, 스킬, MCP 스키마, 메시지, autocompact 예약분, 남은 공간 — 그리고 시작 시 로드되는 모든 항목을 비용순으로, 자체 끄기 플래그가 있는 항목마다 스위치와 함께. 모든 스위치는 확인을 받고, 백업을 남기고, 어떤 에이전트를 재시작해야 하는지 알려줍니다.

```bash
./scripts/ctxmeter-bar.sh install                    # 빌드 후 /Applications에 복사
./scripts/ctxmeter-bar.sh on | off | toggle | status
```

Swift와 SwiftPM만 필요하고 Xcode 전체는 필요 없습니다. 에이전트 아이콘은 Mac에 설치된 각 앱에서 읽어 오므로 상표 이미지는 이 저장소에 없습니다. 주기적 갱신은 세션 사용량만 읽고, 세션 기록은 최대 1분에 한 번, Details 스캔은 창을 열 때나 스위치를 바꾼 뒤에만 실행합니다. [자세히](menubar/README.md).

## 절대 하지 않는 것

프롬프트, 규칙 본문, 스킬 본문, 자격 증명은 복사하지 않습니다. CLI는 명시적으로 켠 MCP 서버 말고는 네트워크에 연결하지 않습니다. 메뉴바 앱은 딱 하나, 업그레이드 여부를 알려주려고 하루 한 번 최신 GitHub 릴리즈 태그를 읽습니다(설정 → Updates에서 끌 수 있음). 백그라운드 감시 없음, 데이터베이스 없음, 텔레메트리 없음. 프롬프트 기록 파일은 열지 않습니다. 스냅샷에는 경로, 개수, 바이트 추정치만 담기며, 테스트가 이를 검증합니다.

읽기 전용을 벗어나는 명령은 둘이고, 둘 다 명시적 플래그가 필요합니다.

| 명령 | 읽기 외에 하는 일 | 조건 |
|---|---|---|
| `mcp-scan` | 설정된 서버를 띄워 도구 목록을 읽음 | `--i-understand-this-launches-servers` |
| `fix` | 설정 파일 하나의 키 하나를 바꿈 | `--disable` / `--enable <target>` |
| 메뉴바 스위치 | `fix`와 같은 편집 | 스위치마다 확인 창 |

나머지는 읽기만 하고, 위 두 명령도 기본 실행은 읽기만 합니다. `mcp-scan`은 셸 환경변수를 서버에 그대로 넘깁니다. 서버가 돌려면 `PATH`와 `HOME`이 필요하기 때문입니다. 모든 MCP 클라이언트가 이렇게 동작하며, 그래서 이 명령은 명시적으로 켜야 합니다.

## 알려줄 수 없는 것

**정적 수치는 바이트 ÷ 4입니다.** 토크나이저가 아니라 근사치입니다. Claude와 Codex의 세션 합계는 정확히 관측한 값이고, Kiro는 퍼센트만 기록하므로 토큰 수를 만들어내지 않습니다.

**훅 출력은 잴 수 없습니다.** 크기가 훅이 실행 중에 무엇을 출력하느냐에 달려 있습니다.

**용량을 모르는 모델은 unknown으로 둡니다.** 컨텍스트 윈도우를 추측하지 않습니다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `ctxmeter` | 점검; 에이전트별 시작 비용 순위 |
| `ctxmeter mcp-scan` | MCP 도구 스키마 측정 (서버를 띄움) |
| `ctxmeter fix` | 토큰을 아낄 수 있는 스위치 목록; `--disable` / `--enable`로 하나씩; `--json`은 전체 |
| `ctxmeter scan` | 전체 인벤토리 스냅샷 (JSON) |
| `ctxmeter telemetry` | 현재 세션 사용량 (JSON), 약 0.2초 |
| `ctxmeter history` | 턴별 컨텍스트와 최근 가장 큰 세션 (JSON) |
| `ctxmeter details` | 에이전트별 컨텍스트 구성과 모든 스위치 (JSON) |
| `ctxmeter --help` | 모든 명령과 플래그 |
| `./scripts/ctxmeter-bar.sh install` | macOS 메뉴바 앱 |

`--home`과 `--workspace`로 모든 명령의 경로를 바꿀 수 있습니다.

## 요구 사항

Node 20+. 메뉴바 앱은 macOS 14+와 Swift 툴체인이 필요하며, Xcode 전체는 필요 없습니다.

macOS에서 테스트했습니다. Linux도 동작할 것이며 Node 쪽은 CI가 검증합니다. Windows용 `mcp-scan`은 구현했지만 검증하지 않았습니다.

## 라이선스

MIT. 자세한 동작과 측정 한계는 [docs/reference.md](docs/reference.md) (영문).
