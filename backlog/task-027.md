# task-027 — 전역 설치된 도구를 앱 터미널이 항상 찾도록 (grok "인식되지 않습니다")

## 요청 (2026-09-28)
AOR 페인에서 `GROK` → "'GROK' 용어가 … 인식되지 않습니다". 설치돼 있는데 → "전역으로 설치되어야 한다". 이어서 설치 파일 생성.

## 조사 (근거)
- `grok.exe`는 `C:\Users\USER\.grok\bin`에 있고(2026-06 설치), 사용자 PATH(레지스트리)에도 들어 있음. 즉 이미 전역 설치 상태
- 사용자 PATH는 3,317자·84개 항목, `.grok\bin`은 2,418번째 글자 뒤(67·68번째 항목)
- AOR 셸(`shell-init.ps1`)은 PATH를 새로 만들지 않고 받은 PATH 앞에 npm·`.local\bin`만 붙임 → 페인 PATH = 앱이 **켜질 때 물려받은 PATH**
- 앱이 받는 PATH는 앱을 띄운 쪽에 따라 다름(탐색기로 띄운 프로세스 2,144자, 제 셸 3,137자). 앱은 이 복사본을 끝까지 쓰므로, 띄운 쪽에 경로가 없었거나 그 뒤에 설치된 도구는 재시작 전까지 모든 페인에서 "없음"이 됨(2026-09-27 17:39 grok 경고와 같은 원인)

## 변경
- `main-winpath.js` (새로 만듦): 등록된 Machine·User PATH를 PowerShell로 UTF-8로 읽어(한글 경로 보존, 고정 명령, 4초 제한, 5초 캐시, 동시 요청은 한 번만) **앱 PATH는 순서 그대로 앞에 두고 빠진 항목만 뒤에** 붙임. `%VAR%` 항목은 펼치고, 대소문자·끝 `\`는 무시하고 중복 제거(드라이브 루트 `C:\`와 `C:`, 단독 `\`는 구분). 읽기에 실패하면 전과 같이 앱 PATH를 그대로 씀
- `main.js`: 터미널 생성(`pty:spawn`)과 CLI 확인(`cli:status`의 where, `findCommandSync`)에 같은 PATH 사용, PATH 키 하나만 유지. 개발 트리에서만 `CARROTCAP_TEST_REGISTRY_PATH`(+`_DELAY_MS`)로 레지스트리 대신 파일
- `renderer.js`: 터미널 준비를 기다렸다가 Quick CLI·흐름 실행, 클릭한 페인 고정
- `package.json`: build.files에 `main-winpath.js`, `npm test`에 test-winpath, `test:winpath` 스크립트

## 리뷰에서 추가로 고친 것 (Codex r1~r6)
- 읽기 실패 시에도 5초에 한 번만 다시 시도(PowerShell이 막힌 PC에서 새 페인마다 느려지지 않게). SKILLS의 claude 조회 전에도 새로 읽음(`running` 확인 앞에서 — 동시 설치 방지 유지). 대기 타이머 정리
- `cli:status` 캐시를 등록 PATH가 바뀌면 무효화, "없음"으로 표시된 CLI는 클릭할 때 다시 확인, 창 포커스 때 표시 갱신
- 터미널이 준비되기 전에 탭을 닫으면 생긴 셸을 바로 종료(누수 방지)
- Quick CLI·흐름 버튼은 터미널이 준비될 때까지 기다린 뒤 실행하고, 기다리는 동안 다른 페인을 고르면 어디에도 보내지 않음(클릭한 페인 고정, 보내기 직전 재확인)

## 테스트
- unit: test-winpath 25(순서 보존, 중복·드라이브 루트·단독 `\`, 한글, %VAR% 펼침, PATH 키 하나, 공유 읽기, 캐시·재읽기·실패 억제, 테스트 파일, 이 PC의 실제 레지스트리) · settings 271 · compress 67 · skills 94 · system-one 81
- E2E `test:winpath` 18 (새로 만듦): 기다리는 중 닫은 탭 → 셸 안 남음 / 기다리는 중 누른 CLAUDE·REVIEW → 한 번 실행 / 기다리는 중 다른 탭 선택 → 어디에도 안 보냄 / **GROK: 시작 때 없음 → 설치 → 새 탭 → 클릭하면 실행**(보고된 경우) / 재확인 중 다른 탭 선택 → 안 보냄. 수정을 끈 변이 실행 3회는 모두 실패함(셸 누수 1→2, 다른 페인 실행 2회, 1→5)
- smoke 75(+4: 시작 후 등록된 도구 → cli:status·버튼 표시·새 페인), skills 92, browser 94, resume 27, aor 33, copy 16, launchers 9
- 실제 상황 재현: 앱 PATH에서 `.grok`을 뺀 채 실행 → AOR 페인 `Get-Command grok` = `C:\Users\USER\.grok\bin\grok.exe`

## 리뷰 (Codex)
- r1~r6 조건부 승인(위 항목들), r7 **승인** (logs/review/task-027_registered-path-r7.md)

## 한계
- 새 터미널부터 적용됨. 설치 전에 이미 열려 있던 셸의 PATH는 바뀌지 않음(Windows 동작) — 새 탭·분할을 열면 됨
- 레지스트리를 읽는 데 PowerShell 시작 시간(수백 ms)이 들어, 5초마다 한 번 새 페인 열기가 조금 늦을 수 있음(그동안 누른 버튼은 기다렸다 실행)
- System One(CLM) 흐름의 CLM/Jev 확인 중 페인을 바꾸는 경우는 같은 확인 코드(`stillTarget`)를 쓰지만 E2E로 자동화하지 않음
