# task-009 — 기능 선별 이식 + v0.2.0 릴리스

## 상태
- 생성일: 2026-09-26
- PM: Claude Code
- 우선순위: P1
- 참고: Cream CLI 0.3.2 (`%LOCALAPPDATA%\Programs\carrotcap\Cream CLI\resources\app.asar`) — 참고만, 코드 통째 복사 금지

## 선별 기준
CARROTCAP의 정체성(터미널 + AOR + AIOps 3-Agent 흐름)에 직접 도움이 되고, 단독으로 검증 가능한 것만 옮긴다.

| 후보 (0.3.2) | 결정 | 이유 |
|---|---|---|
| 터미널 복사/붙여넣기 + 우클릭 메뉴 | **이식** | xterm은 canvas라 기본 Edit 메뉴로 복사가 안 됨 — 기본 사용성 결함 |
| AIOps 문서를 `templates/`로 분리 | **이식(축소)** | main.js 임베드 문자열 제거, 사용자가 템플릿 편집 가능 |
| 폴더 트리 lazy 로딩(`folder:children`) | 보류 | 렌더러 트리 재작성 필요 → 후속 task |
| 토큰 사용량 · CreamWiki · study · webbridge · browser preview | 제외 | Cream 전용 도메인 기능 |
| `templates/claude/skills/*` 대량 번들 | 제외 | 수 MB, CARROTCAP 범위 밖 |

## 구현
### A. 클립보드
- main: `clipboard:read-text` / `clipboard:write-text` (string, 1MB 상한), `term-menu:show` (pty id 검증 wrapper 경유, 네이티브 메뉴 → `term-menu:command`)
- renderer `attachClipboard`: `Ctrl+C`(선택 있을 때만 복사, 없으면 SIGINT) · `Ctrl+Shift+C` · `Ctrl+Shift+V` · `Shift+Insert`, 붙여넣기는 `term.paste()`(bracketed paste). `Ctrl+V`는 셸/Claude CLI 이미지 붙여넣기를 위해 그대로 둠
### B. 템플릿
- `templates/aiops/{supervisor.md, task-001.md, workflow.md, CLAUDE-block.md}` — 기존 임베드 내용과 바이트 동일
- `ensureAiopsProjectStructure`가 `copyTemplateIfMissing`으로 배포, CLAUDE 블록은 템플릿 + 마커로 조립
- `build.files`에 `templates/**/*` 추가
### C. 릴리스
- version 0.2.0 (package.json / package-lock.json), `CHANGELOG.md`
- `npm run pack` 으로 설치본 구조 검증 (userData 경로, 템플릿 포함, asar 쓰기 없음)

## 검증
1. `npm test` 104/104 — AIOps 셋업 E2E(템플릿 동일성, 기존 CLAUDE.md 보존, 재실행 멱등) 포함
2. `npm run test:smoke` 20/20 — 클립보드 왕복, 비문자열 거부
3. CDP 실제 키 입력: `Ctrl+Shift+V` 붙여넣기 → 프롬프트에 입력됨, 드래그 + `Ctrl+Shift+C` → 클립보드에 한 줄 복사됨
4. Codex 리뷰 (task-008 + 009)

## 리뷰 반영 r1 (logs/review/task-008-009_userdata-clipboard-templates.md — ❌ 반려, Critical 2 / Major 2 / Minor 2 / Optional 1)
- Critical: `app.setPath` 전에 userData 폴더 생성 (새 프로필) — 스모크가 존재하지 않는 폴더에서 시작해 검증
- Critical: 파싱 불가 `settings.json`은 `settings.json.corrupt-<시각>`으로 보존 후 재시드 — `--corrupt-settings` 스모크로 검증
- Major ×2: 템플릿 8종을 **쓰기 전에** 전부 확인(`findMissingAiopsTemplates`), CLAUDE 블록도 선읽기. 누락 시 아무것도 쓰지 않고 `aiops:setup`이 누락 파일명을 반환
- Minor: 클립보드/PTY 1MB 상한을 UTF-8 바이트 기준으로 (`isWithinByteCap`), 누락 템플릿·부분 상태·재실행 복구 테스트 추가
- Optional: `saveWorkspaceState` 성공 여부 반환, 마이그레이션 로그는 성공 시에만
- 결과: `npm test` 115/115, 스모크 dev·packaged × fresh·corrupt 모두 통과
