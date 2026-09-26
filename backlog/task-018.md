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

## r2 리뷰 반영
| 항목 | 내용 |
|---|---|
| 가드 위치·대상 | electron-builder는 `HKCU/HKLM\Software\<GUID>\InstallLocation`의 폴더를 옛 제거 프로그램으로 지움 → 이 값도 전용 폴더와 정확히 같아야 함. HKCU·HKLM 모두 검사, 빌드 중 제거 프로그램 생성 단계(`BUILD_UNINSTALLER`)에서는 검사 안 함 |
| 초기화 후 | `customInit`: `initMultiUser`·`/D` 이후에도 `$INSTDIR`은 항상 전용 폴더 |
| 옛 위치 안내 | INSTALLER.md: 옛 위치(`Programs\carrotcap`·`Cream CLI` 폴더)의 제거 프로그램은 **실행 금지**, 수동 정리 절차로 교체 |
| 실행기 충돌 표시 | 다른 프로그램 소유 파일이면 경고 창(무인 설치에서는 자동 확인) |
| 통합 테스트 | `npm run test:launchers`: 가짜 carrotcap.exe(csc 컴파일, 공백+아포스트로피 경로)로 cmd·PowerShell 5.1·pwsh 7·Git Bash에서 `carrotcap "C:\my project" second` 인자 전달 확인, PATHEXT를 .CMD 우선으로 바꾸면 Cream 쪽이 이김(문서화된 한계) |

## 실측 (이 PC, r2 빌드)
- a) 자기 설치 위 업그레이드 → 종료 0
- b) `Software\<GUID>\InstallLocation`을 다른 경로로 → 설치 중단(종료 2), 기존 설치 무변경, 값 복원
- c) 제거 항목 이름을 "Cream CLI 0.3.2"로 → 설치 중단(종료 2), 값 복원
- d) 제거: 앱 폴더·우리 `.bat` 삭제, 표시 없는 같은 이름 파일은 보존 → 테스트 파일 정리 후 재설치, `carrotcap` → `carrotcap.bat`

## r3 리뷰 반영
- `customUnInit`: 제거 프로그램이 레지스트리에서 다시 읽은 `$INSTDIR`이 전용 폴더가 아니면 중단(종료 2) — 변조된 InstallLocation으로 외부 폴더를 지우지 않음
- `%` 포함 경로 허용: 배치 파일에는 `%%`로 기록(설치 스크립트·앱·복구 스크립트 동일), Git Bash는 그대로
- `repair-cli.ps1`: cmd/PowerShell이 실제로 고를 파일(PATH × PATHEXT)을 계산해 우리 실행기가 아니면 원인별 안내 + 종료 2
- `test:launchers`: Git Bash는 `git.exe` 옆 `bin\bash.exe`로 탐색, 없으면 SKIP을 요약에 표시; PATHEXT 변경 사례를 PowerShell 5.1·pwsh 7에도 추가; 폴더 이름에 `%CC_X%` 포함(확장되지 않음 확인)

## 실측 (r3 빌드)
- 업그레이드 종료 0
- InstallLocation을 카나리아 파일이 든 미끼 폴더로 바꾸고 제거 프로그램을 제자리 실행(`_?=`) → 종료 2, 카나리아·앱 보존, 값 복원
- `repair-cli.ps1` → `carrotcap.BAT`로 해석, 종료 0
- test:launchers 7/7, unit 225
