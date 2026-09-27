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
