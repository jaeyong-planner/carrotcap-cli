# task-022 — 설정 유지 + 터미널 안 내용 복사

## 요청
1. "settings.json에 'grok' CLI 설정이 없습니다" — 한 번 세팅한 설정은 계속 유지되게
2. 터미널 안의 내용(특히 Claude Code 화면)을 복사할 수 있게

## 1. 설정 유지
### 원인 (근거)
- 실제 `%APPDATA%\carrotcap-cli\settings.json`에는 codex·grok이 있음 → 파일이 아니라 **저장 경로**가 문제
- `settings:set`이 렌더러가 보낸 사본을 `validateSettings`로 걸러 **파일 전체를 덮어씀**: 렌더러는 시작 때 한 번 읽은 사본을 계속 보내므로, 그 사이 손으로 고친 값이 되돌아가고, 규칙(명령 이름만 허용)에 안 맞는 값(예: 전체 경로)은 조용히 삭제됨
- 쓰기가 원자적이지 않아 쓰는 도중 끊기면 다음 시작 때 "손상"으로 보고 기본값으로 교체될 수 있었음
### 변경
- `applyRendererSettings`: 앱 UI가 바꾸는 값(aor 토글 4개, 마지막 프로젝트 폴더)만 반영하고 cli·엔진 경로·폰트·셸 등은 **디스크 값 그대로** 유지. 렌더러는 cli를 쓸 수 없음
- `ensureBuiltinCli`: claude·codex·grok이 없거나 비면 시작 시·settings:get 때 복구
- `saveSettings`: 임시 파일 + rename
- CLI 명령에 존재하는 파일의 절대 경로 허용(`isAllowedCliCommand`) — 사용자가 직접 넣은 값은 이제 지워지지 않으므로

## 2. 터미널 복사
### 원인 (실측)
- Claude Code가 마우스 추적을 켬(`?1000h`/`?1006h`, 기본 모드 "full") → xterm에서 드래그가 앱으로 가서 선택 불가. 실제 Claude로 확인: `enable-mouse-events`, 드래그 후 클립보드 비어 있음
- `CLAUDE_CODE_DISABLE_MOUSE_CLICKS`(휠만)로도 추적은 켜진 채라 해결 안 됨
### 변경
- 마우스 추적이 켜진 페인에서 **수식키 없는 왼쪽 드래그는 항상 텍스트 선택**(xterm의 강제 선택=Shift+누름으로 다시 보냄). 휠은 앱으로, Shift/Alt/Ctrl+클릭은 그대로
- 선택하면 바로 복사(기존), 선택 중 Ctrl+C 복사(기존)
- 실제 Claude로 재확인: 드래그 → 클립보드에 화면 텍스트
- 한계: Claude 화면 안에서의 마우스 클릭 동작(있다면)은 페인에서 쓸 수 없음 — 선택을 우선

## 테스트
- unit 246(+13), aor 26(+4: 시작 시 codex/grok 복구, 앱 저장 후에도 손으로 고친 값 유지, 임시 파일 없음), copy 7(신규: 마우스 추적 중 드래그 복사·Ctrl+C·Shift+드래그 — 수정 전 코드에서 실패 확인), smoke 53, browser 94, resume 27

## Codex r1 (⚠️ 조건부, Major 2 / Minor 3) 반영
- 실행 중 settings.json 삭제·손상 → 저장 시 손상 파일을 `.corrupt-<시각>`으로 백업하고 번들 기본값+마이그레이션+기본 CLI로 다시 만든 뒤 저장. 정상 파일도 저장 전 기본 CLI 복구
- E2E: 삭제 후 저장 → CLI 3개 포함 전체 설정, 손상 후 저장 → 백업 1개 + 전체 설정, 이후 cli:status 정상
- 헤더 안내 "Shift+드래그로 선택" → "드래그로 선택·복사"(툴팁에 휠은 프로그램으로)
- 실제 PowerShell로 공백+아포스트로피 경로의 CLI 실행: 한 프로그램으로, 인자 속 `$(...)`는 실행되지 않음
- copy E2E: 더블클릭 단어 선택·복사, 포커스 유지
- 테스트: unit 248, aor 30, copy 9

## Codex r2 (⚠️ 조건부, Critical 없음) 반영 — 남은 검증 보강
- 재구성 뒤 실제 CLI 실행: 전체 경로로 지정한 claude가 앱 저장 후에도 유지되고, cli 페인이 그 명령을 인자와 함께 실행(E2E)
- POSIX quoting: Git Bash로 공백+아포스트로피 경로·`$(...)` 인자 실제 실행
- `writeJsonAtomic` 분리 + 실패 주입(쓰기/rename 실패 시 기존 파일 유지·임시 파일 없음), 기존 파일 교체
- 마우스 추적 앱: 세 번 클릭 줄 복사, 일반 클릭은 선택(앱에 안 감), Ctrl+클릭·휠·오른쪽 클릭은 앱으로(SGR 보고 확인)
- 툴팁: "일반 왼쪽 클릭·드래그는 선택, 휠과 Shift/Alt/Ctrl+클릭은 프로그램으로"
- 테스트: unit 252, aor 33, copy 14, smoke 53, browser 94
- r3: ⚠️ 조건부(Critical·Major 없음) Minor 1 반영 — Windows에서 Shift+클릭은 xterm 강제 선택이라 선택으로 동작: 툴팁 수정, Alt+클릭 전달·Shift+클릭 선택 E2E 추가 (copy 16)
