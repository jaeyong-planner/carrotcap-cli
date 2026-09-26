# task-018 — `carrotcap` 명령 → CARROTCAP CLI, 원클릭 설치

## 요청
- 터미널에서 `carrotcap` 입력 시 CARROTCAP CLI가 열리게
- 설치 파일(setup)을 클릭하면 바로 설치되게

## 조사 (근거)
- 현재 `carrotcap` → `WindowsApps\carrotcap.cmd` → **Cream CLI.exe**. Cream은 실행할 때마다 `carrotcap.cmd`·`aor.cmd`를 다시 씀(asar 확인)
- `WindowsApps`는 **시스템 PATH**에도 있어 사용자 PATH 앞에 무엇을 넣어도 못 이김
- 같은 폴더에서는 PATHEXT 순서(.COM;.EXE;.BAT;.CMD)로 찾음 → `carrotcap.bat`이 `carrotcap.cmd`를 이김. 실측: pwsh 7·PowerShell 5.1·cmd 모두 BAT 우선, Git Bash는 확장자 없는 파일
- 기존 설치 스크립트의 기본 설치 폴더 `Programs\carrotcap`은 **Cream CLI 설치 폴더의 부모** — 제거 시 `$INSTDIR` 통째 삭제 → Cream까지 지울 위험
- 사용자 PATH 3,317자 — NSIS 문자열 한도(기본 1,024)를 넘어 기존 설치 스크립트의 PATH 추가가 PATH를 잘라 쓸 위험. 사용자 PATH에는 Cream이 자기 폴더를 14번 중복 추가해 둔 상태(손대지 않음)

## 변경
| 항목 | 내용 |
|---|---|
| 명령 | `WindowsApps\carrotcap.bat`(cmd/PowerShell) + 확장자 없는 `carrotcap`(Git Bash, 백그라운드 실행). Cream의 `carrotcap.cmd`·`aor.cmd`는 건드리지 않음 |
| 앱 자가 복구 | 패키지 실행 시 두 파일을 현재 exe 경로로 유지(링크·폴더면 건너뜀). 사용자 PATH 수정 제거, `aor.cmd` 쓰기 제거 |
| 설치 | 원클릭(`oneClick`), 사용자 단위, 설치 후 자동 실행, 바탕화면·시작 메뉴 바로가기, 파일명 `CARROTCAP-CLI-Setup-<ver>.exe` |
| 설치 폴더 | `%LOCALAPPDATA%\Programs\carrotcap-cli` (전용) |
| 제거 | 우리 파일(`carrotcap.bat`, `carrotcap`)만 삭제 |

## 한계
- `aor` 명령은 계속 Cream CLI
- 누군가 WindowsApps에 `carrotcap.com`/`carrotcap.exe`를 두면 그쪽이 우선
- 이미 열려 있는 터미널은 영향 없음(파일 기반이라 새 창 불필요, 바로 동작)

## 테스트
- unit 221(shim 내용·Git Bash 인용·위험 경로 거부), smoke 50
