# 05. 시장 재조사 + 전체 코드 검토 — 2026-10-16

`04`(09-28) 이후 18일. 로컬 버전: Claude Code 2.1.301 · codex-cli 0.163.0 · kiro-cli 2.31.1 (confirmed).
표기: confirmed = 이번 세션에 공식 문서·소스·로컬 파일로 확인 / hypothesis = 추론.

## 1. 우리가 방금 틀린 것 (confirmed)

- **Kiro도 MCP를 기본 지연 로딩한다.** IDE 1.3+는 자동, CLI는 로컬 V3 세션 2.31+에서 기본 켜짐, V2는 `toolSearch.enabled`로 켜야 함(기본값 5% 또는 50,000 토큰) — https://kiro.dev/docs/mcp/tool-search/ (2026-10-13). v0.1.2는 Kiro를 "upfront"로 세서 이 머신에서 8,914 토큰을 과대 계상하고, 그 서버들을 `fix` 1~4순위로 제안한다.
- Codex "always deferred"는 tool_search를 지원하는 모델/provider에서만 참(`codex-rs/features/src/lib.rs`, 0.142.2~0.143.0 릴리즈).
- Claude: 서버의 `alwaysLoad:false`는 2.1.287부터 "전부 지연"이다. 도구 단위 `_meta["anthropic/alwaysLoad"]`도 있다(2.1.285).

## 2. 판을 바꿀 수 있는 사실: Claude가 실제 프롬프트 구성을 로그에 남긴다 (confirmed)

- Claude Code 2.1.300(10-14)부터 transcript에 `api-request-shape` 레코드가 생겼다. `shape.system`(블록 배열)과 `shape.tools[]`(`name`, `description`, `input_schema`, `defer_loading`)가 들어 있다.
- 이 머신 최신 세션에서 확인: system 3블록 약 13KB, tools 16개 약 71KB. `ToolSearch`와 `DeferredToolPlaceholder`가 포함되어 있다.
- 의미: Claude에서는 바이트÷4 추정 대신 **실제로 전송된 시스템 프롬프트와 도구 바이트**를 셀 수 있다. 본문은 저장하지 않고 크기만 세면 약속(내용 복사 안 함)과도 맞는다.
- 경쟁 1위 CCO는 "offline only, no runtime coupling"을 명시적으로 고수한다(CCO discussion #9). **로그 기반 실측이 우리의 방어선이다.**

## 3. 경쟁 (stars는 10-16 기준, gh api로 확인)

| 도구 | ★ | 겹침 |
|---|---|---|
| mcpware/cross-code-organizer (CCO) | 383 | **최대.** 웹 대시보드. always-loaded와 deferred 구분, 항목별 token(tokenizer), @import 확장, MCP 프로젝트별 끄기, Undo, 보안 스캔. Claude·Codex·OpenCode·DSH 지원. Kiro, 메뉴바, 실측 없음 |
| Claude Code 내장 `/context all`, `/doctor`, `/skill-doctor`(2.1.261) | — | 항목별 비용 + 안 쓰는 skill 추천. 단일 에이전트 |
| Kiro `/context show`, `/tools` · Copilot CLI `/context` | — | 각자 자기 것만 보여줌 |
| skillreaper, claude-slim, skills-janitor, mcp-prune 외 다수 | 0~122 | 로그 기반 미사용 감지(BACKLOG P2-1)는 **이미 다수가 구현** |
| Jithendrag22/sift, ctxlint Action | 0, 11 | CI budget(P1-6) 구현체 있음, 다만 traction 없음 |
| context-mode | 29,982 | 런타임 출력 축. 상호보완 |
| CodexBar 22.5K · ccusage 19K · abtop 3.7K | — | 비용·쿼터·HUD |

HN 반응(confirmed, Algolia): 무언가를 "줄여 주는" 도구는 떴다(context-mode 84pt, mcp2cli 146pt). 감사·정리 도구는 거의 반응이 없었다(skillreaper 1pt, mcp-tidy 10pt). Reddit에서는 "시작 전에 35%가 이미 차 있다" 같은 **숫자 글**이 반응을 얻었고, 댓글 다수는 "`/context` 쓰면 된다"였다.

## 4. 남은 차별점 (hypothesis, 이번 검색 범위 기준)

1. 같은 저장소를 **에이전트별로 나란히** 비교. CCO는 하네스를 하나씩 전환해서 본다.
2. **실측**: 로그의 첫 요청 + Claude `api-request-shape`. 경쟁자는 추정만 한다.
3. **drift·회귀**: "어제보다 시작 비용 +6K, 원인 Claude 2.1.x 업데이트". 근거 사례 claude-code#49593(8%→22%), sumitsuke 실측. 메뉴바 상주 형태와 맞는다.
4. Kiro 지원, 네이티브 메뉴바.
5. multi-agent CI budget과 공유 카드: 구현체는 있으나 traction 0.

이미 남이 하는 것: deferred 구분, 백업이 있는 끄기, 턴별 그래프, 로그 기반 미사용 감지, "로컬 전용".

## 5. 코드 검토 상위 항목 (confirmed = 코드를 직접 읽음)

| # | 심각도 | 항목 | 위치 |
|---|---|---|---|
| 1 | HIGH | Kiro 로딩 판정이 틀림(§1) | `src/tool-loading.js` `mcpLoading` |
| 2 | HIGH | `applyPlan`이 원자적이지 않고 재확인도 없음. plan 이후 에이전트가 파일을 다시 쓰면 그 변경이 사라짐 | `src/fix.js` `applyPlan` |
| 3 | HIGH | instruction이 전역 파일만 계상됨. workspace `CLAUDE.md`·`@import`·`AGENTS.md` 계층·`.kiro/steering`이 빠짐. `scanWorkspace` 결과는 아무 데서도 쓰지 않음 → "your setup is X" 과소 | `src/audit.js` `instructionFinding`, `src/scanner.js` `scanWorkspace` |
| 4 | HIGH | 세션 로그를 전부 동기로 통째로 읽음(`lines()`). 이 머신 기준 Codex 459MB, Claude 276MB. audit·details·메뉴바 60초 주기마다 반복. Swift `CLIRunner`에 timeout 없음 | `src/session-history.js`, `scanner.js` telemetry, `CLIRunner.swift` |
| 5 | MEDIUM | 문구가 낡음: "MCP tool schemas are the largest reported cost in the wild", "MCP servers are usually the largest removable cost" | `src/audit.js`, `src/fix.js` |
| 6 | MEDIUM | mcp-scan: stdin EPIPE 핸들러 없음, `exit`/`close` race, 손자 프로세스 고아, HTTP 응답 크기 무제한, `CLIENT_INFO` 이름이 여전히 'agentlens' | `src/mcp-cost.js` |
| 7 | MEDIUM | TOML reader가 4~5벌이고 동작이 서로 다름(멀티라인 배열, inline env, quoted section 이름에서 fix 실패) | scanner / mcp-cost / config-edit / switches |
| 8 | MEDIUM | `.ctxmeter/` 캐시와 snapshot을 사용자 저장소 안에 gitignore 없이 만듦 | `src/cli.js` |
| 9 | MEDIUM | MCP 설정 충실도: headers, sse, `${VAR}`, 플러그인 번들 MCP, Kiro workspace mcp.json | `mcp-cost.js`, `claude-mcp.js` |
| 10 | MEDIUM | CI가 ubuntu + Node 20만 돎. Windows `shell:true` arg 결합. scanner.js 903줄 | `ci.yml`, `mcp-cost.js` |

포맷 깨짐 위험(confirmed, 공식 소스): Kiro V3는 "디렉터리 레이아웃에 의존하지 말고 ACP `session/list`를 쓰라"고 명시. Codex는 `.jsonl.zst` 압축이 flag 뒤에서 준비 중. Codex `[plugins._default]` 신설(0.163).

## 6. 하네스 확장 (stars confirmed)

OpenCode 214K(SQLite `~/.local/share/opencode/opencode.db`, AGENTS.md와 `~/.claude/skills` fallback, MCP 기본 codemode)가 비용 대비 청중이 가장 크다. Gemini CLI는 6-18부로 무료 사용자가 Antigravity CLI로 옮겨 가고 있어 우선순위를 낮춘다.
