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

## ⚠️ 사고 기록 (2026-09-27)
- r1 리뷰 반영 빌드로 이 PC에 무인 설치(`/S`)를 실행 → **설치된 Cream CLI 0.3.2가 제거되고 그 폴더에 CARROTCAP이 설치됨**
- 원인: CARROTCAP과 Cream CLI의 **appId가 같음**(`com.carrotcap.cli` → 같은 제거 키 `1f86aaf2-…`). electron-builder가 Cream을 "이전 버전"으로 보고 Cream의 제거 프로그램을 실행(이때 Cream의 `carrotcap.cmd`·`aor.cmd`도 삭제됨). Cream 키에 `InstallLocation`이 없어 설치 경로 검사도 통과
- 설치 전에 appId·제거 키 겹침을 확인하지 않은 것이 원인(작업자 실수)
- 사용자 결정: Cream은 복원하지 않음. Cream 사용자 데이터(`%APPDATA%\cream-cli`)와 0.3.2 설치 파일(`%LOCALAPPDATA%\cream-cli-updater\installer.exe`)은 남아 있어 나중에 복원 가능
- 조치: 잘못 들어간 CARROTCAP을 자체 제거 프로그램으로 제거 → appId를 `com.carrotcap.carrotcap-cli`(제거 키 `df5cde1f-…`)로 변경 → 설치 스크립트 가드 강화 → 전용 폴더에 재설치

## r1 리뷰 반영 + 사고 후 보강
| 항목 | 내용 |
|---|---|
| appId 분리 | `com.carrotcap.carrotcap-cli` — Cream과 제거 키가 겹치지 않음 |
| 설치 가드 | 우리 appId의 제거 항목이 있는데 이름이 "CARROTCAP CLI"가 아니거나, 제거 프로그램 경로·InstallLocation이 전용 폴더 밖이면 **설치 중단** (다른 설치를 지우지 않음) |
| 소유권 표시 | 실행기 2번째 줄 `CARROTCAP-CLI-LAUNCHER`. 설치·앱·복구 스크립트·제거 모두 이 표시가 있거나 파일이 없을 때만 쓰기/삭제, 링크·폴더는 건너뜀 |
| Git Bash 실행기 | 설치 스크립트가 바로 생성 (앱과 바이트 동일 — 실측) |
| 복구 스크립트 | `scripts/repair-cli.ps1` 새 방식으로 재작성 (PATH 수정·Cream 파일 덮어쓰기 제거) |
| 문서 | `INSTALLER.md` 갱신 (경로·실행기·가정: 기본 PATHEXT, WindowsApps on PATH) |

## 실측 검증 (이 PC)
- 가드: 가짜 "Other App" 제거 항목을 우리 GUID로 만든 뒤 설치 → 종료 코드 2, 설치 안 됨, 항목 그대로 (테스트 후 삭제)
- 실제 설치: `Programs\carrotcap-cli`, 제거 항목 `df5cde1f-…`, 옛 키 없음, `Programs\carrotcap` 무변경, 바탕화면·시작 메뉴 바로가기
- `carrotcap` 해석: pwsh 7·PowerShell 5.1 → `carrotcap.bat`, Git Bash → `carrotcap`; 실행 시 설치 폴더의 carrotcap.exe가 뜸
- 앱 첫 실행 후 실행기 파일 해시 변화 없음(설치 스크립트와 앱 내용 일치)
- unit 225
