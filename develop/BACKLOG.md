# Backlog — 10K 스타를 향해 (2026-09-28)

근거: `research/01~04`, `PLAN.md`. 현재 ★1, v0.1.0.

## 전제 (솔직하게)

- 10K는 상위 0.1% 결과다. 6개월 동안 하루 55~70개 페이스여야 한다(`research/02`). HN 1회는 ~289개.
- 약속할 수 없는 숫자다. 할 수 있는 건 (1) 첫 리뷰어가 무너뜨릴 약점 제거, (2) 청중을 넓히는 하네스 지원, (3) 공유되는 산출물, (4) 꾸준한 엔진.
- 전략이 바뀐 지점(`research/04`): **Claude·Codex가 MCP 스키마를 기본으로 지연 로딩한다.** "MCP가 제일 비싸다"는 헤드라인은 약해졌고 과대 계상 위험도 있다. 무게중심을 **실측 시작 비용 + 여러 에이전트 + 무엇을 끌지**로 옮긴다.

우선순위: **P0** 런칭 전에 반드시 · **P1** 청중과 엔진 · **P2** 깊이. 크기: S(반나절) · M(1~2일) · L(3일 이상).

---

## P0 — 신뢰와 첫 화면 (런칭 전에 반드시)

### P0-1. MCP 지연 로딩 반영 · M · ✅ 완료 (2026-09-28, `execution/11`)
- **문제**: `mcp-scan`/`audit`가 스키마 전체를 시작 비용으로 센다. Claude(tool search 기본 on)와 Codex(지원 서버에서 기본 적용)는 이름만 올리고 나머지는 필요할 때 불러온다. 지금 코드에는 이를 다루는 부분이 없다(`src/`에 `defer`/`ENABLE_TOOL_SEARCH` 없음, confirmed).
- **할 일**: 하네스별로 로딩 모드를 판정한다.
  - Claude: `ENABLE_TOOL_SEARCH`, `ANTHROPIC_BASE_URL`, 서버별 `alwaysLoad`.
  - Codex: 버전과 `tool_search_always_defer_mcp_tools`.
  - Kiro: 동작을 확인해야 한다(unknown).
- 보고는 "선로딩 N 토큰 / 지연(필요 시) M 토큰"으로 나눈다. `fix` 목록에서 지연된 서버의 절감액은 "시작 시 0, 호출 시 X"로 표시한다.
- **완료 기준**: 이 머신에서 audit 합계가 실측(P0-2)과 설명 가능한 범위로 맞는다. README 수치도 갱신한다.
- **왜 P0**: HN 첫 댓글이 "Claude는 이미 MCP를 지연 로딩하는데?"가 될 것이다. 런칭은 한 번뿐이다.

### P0-2. 실측 시작 비용 (observed baseline) · M · ✅ 완료 (2026-09-28, `execution/11`, 헤드라인은 중앙값이 아니라 최저값)
- **발상**: Claude·Codex 로그에는 각 세션 **첫 턴 입력 토큰**이 정확히 남는다. 이것이 추정이 아니라 실제 "타이핑 전 비용"이다. `session-history.js`가 이미 턴별 usage를 읽고 있다.
- **할 일**: 최근 N개 세션의 첫 턴 입력 토큰 중앙값을 하네스별로 낸다. audit 첫 줄을 "추정 33,458"에서 **"실측: 최근 10세션 중앙값 41,2xx 토큰(Claude)"**로 바꾼다. 추정 내역은 그 아래 "이 중 설명되는 부분"으로 둔다. Kiro는 퍼센트만 표시한다.
- **완료 기준**: 실측과 추정의 차이(시스템 프롬프트·내장 도구 몫)가 한 줄로 설명된다.
- **왜 P0**: 경쟁 도구 대부분이 추정만 한다. "실측"은 반박이 어렵고 공유할 만한 숫자다.

### P0-3. `npx ctxmeter` 한 줄 설치 (npm 게시) · S · ✅ 완료 (v0.1.1, `execution/10`)
- 이름은 비어 있다(confirmed). `npx github:...`는 동작하지만 길고, 처음 실행할 때 git clone이 일어나 느리다.
- 되돌리기 어렵고(72시간 뒤에는 unpublish 불가) npm 계정이 필요하다 → **사용자 결정**.
- 태그 push 시 CI에서 `npm publish --provenance`로 게시하도록 자동화한다.

### P0-4. 저장소 첫인상 정리 · S
- GitHub description의 "read-only"를 고친다(`fix`와 스위치가 생겨 사실이 아님).
- homepage 필드와 social preview 이미지(1280×640)를 넣는다. 트위터·슬랙에 링크를 붙였을 때 보이는 카드다.
- ~~README 첫 화면을 P0-2의 실측 한 줄과 데모 GIF 재녹화로 바꾼다.~~ 완료(`execution/11`).

### P0-5. 남은 측정 공백 · M
- 원격 MCP의 `headers`(Authorization)를 전달하지 않는다.
- `type: "sse"`를 지원하지 않는다.
- 플러그인에 번들된 MCP(context7, github)를 측정하지 않는다. 이번 Details 화면에서도 "unknown"으로 보였다.
- "unknown"이 많으면 도구가 덜 된 것처럼 보인다.

---

## P1 — 청중 넓히기 (하네스 = 시장)

### P1-1. OpenCode 지원 · M
- opencode ★210K. 우리가 지원하는 세 하네스 청중을 합친 것보다 크다. abtop(★3.6K)이 이미 지원한다.
- 설정 구조(skills·rules·MCP·AGENTS.md)와 세션 저장 방식(sqlite)을 조사한 뒤 adapter를 추가한다.

### P1-2. Gemini CLI 지원 · M
- ★107K. `GEMINI.md`, 확장, MCP 설정을 다룬다.

### P1-3. 하네스 adapter 인터페이스 문서화 + "새 하네스 추가" good first issue · S
- 기여자가 늘면 입소문이 붙는다(`research/02`: 기여자 300명 → 월 수백 개). Cursor, Cline, Copilot CLI, Amp는 커뮤니티 PR로 받는다.

### P1-4. 비 macOS용 `ctxmeter watch` (TUI) · L
- 메뉴바는 macOS 전용이다. abtop의 성공은 TUI 수요를 보여준다. Linux·Windows 사용자에게 턴별 그래프를 터미널에서 보여준다.

---

## P1 — 공유되는 산출물 (바이럴 장치)

### P1-5. `ctxmeter card` — 공유용 요약 카드 · M
- "내 에이전트는 타이핑 전에 41k 토큰을 쓴다 · 1위: aws-core 스킬 1.9k" 형태의 SVG/PNG를 만든다.
- 경로·이름은 옵션으로 익명화한다. README 배지 버전(`![context](...)`)도 둔다.
- `research/02`: 스크린샷이 곧 배포 수단이다. 사람들이 자기 숫자를 올리게 만든다.

### P1-6. `ctxmeter check --max <tokens>` + GitHub Action · M
- 저장소의 `AGENTS.md`, `CLAUDE.md`, `.mcp.json`, 스킬이 예산을 넘으면 CI를 실패시킨다.
- 팀 단위 반복 사용이 생기고, 설치된 Action마다 링크가 퍼진다(Marketplace 노출).
- 설정 파일을 건드리지 않는 읽기 전용이라 약속과도 충돌하지 않는다.

### P1-7. 에이전트 안에서 묻기 — 스킬/플러그인 배포 · S
- tare, token-audit-skill이 이미 쓰는 경로다. "왜 벌써 컨텍스트가 찼어?"라고 물으면 스킬이 `ctxmeter --json`을 실행해 답한다.
- Claude 플러그인 마켓플레이스와 `npx skills add`에 올린다. 채널이 하나 늘어난다.

---

## P1 — 엔진 (꾸준히)

### P1-8. 릴리즈 리듬 · S (설정) + 계속
- 주 1회 이상 태그와 릴리즈 노트를 낸다. CodexBar는 312일에 릴리즈 100개였고, 유명하지 않아도 따라 할 수 있는 유일한 행동이다.
- `CHANGELOG.md`를 두고, 태그 push 시 릴리즈 노트를 자동 생성한다. 메뉴바 업데이트 알림이 이 리듬을 사용자에게 보여준다.

### P1-9. awesome 리스트 · S
- **awesome-claude-code(★54.7K): 2026-10-08부터 자격.** 웹 폼으로 **사용자가 직접** 제출해야 한다. 설명은 기술문 한 줄. 초안은 제출일에 준비한다.
- awesome-mcp-servers(★95.6K)의 도구 섹션, awesome-codex류, awesome-macos(메뉴바).

### P1-10. 런칭 순서 · S (준비)
1. **국내 먼저**: GeekNews, 디스콰이엇, 페이스북 AI 개발 그룹. 한국어 README가 있고 사용자의 홈 그라운드라 첫 불씨로 현실적이다. 피드백으로 P0 약점을 한 번 더 걸러낸다.
2. Reddit r/ClaudeCode, r/codex, r/LocalLLaMA 성격에 맞는 곳.
3. **Show HN은 한 번뿐**: P0-1·2·3이 끝난 뒤에 한다. 화~목 08~10시 EST. 제목 60~80자, "open source, local, no account"로 시작하고 AI를 앞세우지 않는다. 기능 목록보다 개인 이야기가 약 3배 반응이 좋다.
   - 제목 초안: "Show HN: ctxmeter – see what Claude Code, Codex and Kiro load before you type"

### P1-11. 이슈 24시간 내 응답, 템플릿, CONTRIBUTING · S
- 빠르게 성장하는 저장소와 가장 강하게 상관된 습관이다(`research/02`).

### P1-12. 서명된 메뉴바 앱 + Homebrew cask · M · 비용 발생
- Developer ID(연 $99), 공증, `brew install --cask ctxmeter`. 소스 빌드 장벽(Xcode CLT, Node)이 동료 수준을 넘는 순간 필요하다.
- 사용자 결정. 그 전까지는 Homebrew tap으로 CLI만 먼저 제공해도 된다.

---

## P2 — 제품 깊이 (조치의 질)

### P2-1. "안 쓰는 것" 찾기 · M ★ 강력 추천
- 로그에는 실제로 호출된 도구와 스킬이 남는다. **"최근 14일간 한 번도 호출되지 않은 MCP 서버·스킬 그룹 = 끄기 후보 1순위"**를 보여준다.
- 크기순보다 설득력이 훨씬 크다. "비싼데 안 쓴다"가 행동을 부른다. 경쟁 도구 중 이걸 하는 곳은 확인하지 못했다(unknown이므로 착수 전 재조사).

### P2-2. 중복 규칙 탐지 · S
- 같은 규칙이 `CLAUDE.md`, `AGENTS.md`, `.kiro/steering`에 중복돼 있는 경우를 찾는다. 여러 에이전트를 쓰는 사람만 겪는 문제라 우리만 풀 수 있다. 편집은 하지 않고 보고만 한다(원칙 유지).

### P2-3. 런타임 도구 출력 귀속 · M
- 세션에서 어떤 도구 결과가 토큰을 가장 많이 먹었는지 보여준다(context-mode가 푸는 "나머지 반쪽"을 측정만 한다).
- 경쟁이 아니라 보완이다. "그 부분은 context-mode를 쓰라"고 링크해 상호 노출을 노린다.

### P2-4. 추정 정밀도 · M
- 바이트÷4 대신 하네스별 실제 토크나이저(선택적 의존성)를 쓰거나, P0-2 실측으로 보정 계수를 학습한다.

### P2-5. TOML 리더 4개 통합, `cli.js` 커버리지 86% → 90% · S
- 기술 부채다. 기여자가 늘기 전에 정리한다.

### P2-6. 메뉴바 알림 · S
- 컨텍스트 N% 초과, 컴팩션 임박일 때 알림을 보낸다. 기본값은 끔.

---

## 하지 않을 것 (결정 유지)

- 비용·쿼터·요금 (사용자 결정, CodexBar·ccusage의 영역).
- 사용자가 쓴 글(`CLAUDE.md`, 규칙, steering) 편집.
- 텔레메트리. 성장 측정은 GitHub Insights, npm 다운로드 수, 릴리즈 다운로드 수로 한다.

## 이정표

| 단계 | 목표 | 관문 |
|---|---|---|
| 1 | ★100 | P0 전부 + 국내 런칭 + awesome-claude-code(10-08~) |
| 2 | ★1K | OpenCode·Gemini 지원, card, check Action, Show HN 1회 |
| 3 | ★10K | 주간 릴리즈 6개월, 기여자 하네스 확장, 입소문 |

## 다음 한 걸음

P0-1과 P0-2를 함께 한다(같은 데이터 경로). 둘이 끝나면 README 헤드라인과 데모 GIF가 바뀌고, 그 뒤에 국내 런칭 → 10-08 awesome 제출 → Show HN 순서로 간다.
