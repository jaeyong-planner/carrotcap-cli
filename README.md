# 🥕 CARROTCAP CLI

AOR 라우팅이 디폴트로 적용된 데스크톱 터미널.  
**탭 + 분할(LEFT/RIGHT/UP/DOWN) + 폴더 사이드바 + 드래그앤드롭 + CLAUDE(코딩)/CODEX(리뷰)/GROK(이미지·영상) 원-클릭 호출**.

---

## 설치 (Windows)

선결 조건 — Node.js 18+ (검증: v22.17.0), git.  
PTY는 `@homebridge/node-pty-prebuilt-multiarch`의 **프리빌트 바이너리**를 쓰므로 Visual Studio Build Tools는 필요 없습니다.

```powershell
cd "<이 저장소 경로>"
# 소스가 Google Drive(내 드라이브) 안에 있으므로 node_modules는 Drive 밖에 설치하고 junction으로 연결합니다.
powershell -ExecutionPolicy Bypass -File scripts\setup-dev.ps1
npm start
```

> Drive 밖이라면 `npm ci` 만으로도 됩니다. 프리빌트 바이너리가 현재 Electron ABI와 맞지 않으면 PTY는 폴백 모드(child_process)로 동작하며, 이때 `npm run rebuild`로 재빌드할 수 있습니다.

### 빌드 / 테스트

| 명령 | 설명 |
| --- | --- |
| `npm test` | 보안 헬퍼 + AIOps 셋업 단위 테스트 (Electron 없이 실행) |
| `npm run test:smoke` | 실제 앱을 띄워 CDP로 점검 (sandbox · PTY · 악성 IPC · 키보드/입력창 · 복사 · CLI 구성) |
| `npm run test:resume` | 앱을 4번 띄워 세션 기록 → 비정상 종료 → 이어하기 → 정리 → 즉시 종료까지 점검 |
| `npm run test:media` | 가짜 grok으로 `run-media.ps1` 성공·실패·경로 검증 점검 |
| `npm run pack` | 설치 없이 `release/win-unpacked/` 생성 |
| `npm run dist:win` | NSIS 설치 파일 생성 (`release/CARROTCAP-CLI-<ver>-win-x64.exe`) |

> AOR 엔진 바이너리(`AOR/engine/**/bin/`, 약 85MB)는 git에 포함되지 않습니다. 빌드 전 해당 위치에 직접 배치하세요.

---

## 사용법

### 1) 폴더 선택

좌측 사이드바 상단의 📁 버튼 → 작업 폴더 선택. 이후 새 페인은 그 폴더에서 시작합니다.

### 2) 탭 / 분할

- **상단 ＋ 버튼** 또는 `Ctrl+Shift+T` → 새 탭. `Ctrl+Shift+W` → 활성 페인 닫기.
- 좌측 **SPLIT 패널** 또는 `Alt+Shift+→/←/↑/↓` → RIGHT/LEFT/UP/DOWN 분할.
- 분할 사이의 회색 바를 드래그해서 비율 조절.
- `Ctrl+W`(단어 삭제), `Ctrl+T`, `Ctrl+Shift+←/→`(단어 선택)는 터미널 편집 키라 앱이 가로채지 않습니다 (v0.2.0부터).

**입력창** (터미널 아래)

- 일반 입력칸처럼 편집한 뒤 `Enter`로 활성 터미널에 보냅니다. `Shift+Enter` 줄바꿈, `Ctrl+A` 전체 선택 → `Delete` 전체 삭제, `↑/↓` 이전 입력, `Esc` 터미널로 이동.
- `Ctrl+Shift+Space` 입력창으로 이동, 상단 **입력창** 버튼으로 보이기/숨기기.
- 사이드바 버튼을 누른 뒤 바로 타이핑해도 글자가 사라지지 않고 입력창으로 들어갑니다.

**복사 / 붙여넣기**

| 동작 | 단축키 |
| --- | --- |
| 복사 | **드래그를 놓는 순간 자동 복사**. 선택 후 `Ctrl+C`(선택이 없으면 평소처럼 중단 신호) 또는 `Ctrl+Shift+C`도 가능 |
| 화면/출력 전체 복사 | 우클릭 → *보이는 화면 복사* / *전체 출력 복사* (선택이 어려운 TUI 화면에서 유용) |
| TUI가 마우스를 잡을 때 | 페인 헤더에 *Shift+드래그로 선택* 이 뜨면 `Shift`를 누른 채 드래그 |
| 붙여넣기 | `Ctrl+Shift+V` 또는 `Shift+Insert` (`Ctrl+V`는 셸/CLI 기본 동작 유지) |
| 메뉴 | 터미널 우클릭 → 복사 · 붙여넣기 · 화면/전체 출력 복사 · 모두 선택 · 화면 지우기 |

### 3) CLI 원-클릭

좌측 **QUICK CLI** 패널에서 클릭 → 활성 페인에 명령이 입력되어 즉시 실행됩니다.

| 버튼 | CLI | 역할 |
| --- | --- | --- |
| CLAUDE | `claude` | 코딩 (PM · 구현 · 조사) |
| CODEX | `codex` | 코드 리뷰 |
| GROK | `grok` | 이미지·영상 제작 — `/imagine`, `/imagine-video` (처음 한 번 `grok login`) |

설치되지 않은(PATH에 없는) CLI 버튼은 흐리게 취소선으로 표시됩니다. Gemini·Antigravity는 v0.2.0에서 제거됐고, 기존 설정에서도 자동으로 빠집니다. 명령은 사용자 `settings.json`(아래 9번)의 `cli` 섹션에서 자유롭게 바꿀 수 있습니다.

### 4) AOR 모드 / AIOps 모드

- **AIOps 모드는 기본 ON** (v0.2.0). 프로젝트 폴더를 열고 새 페인이 뜨면 `agents/`·`backlog/`·`logs/`·`scripts/`·`CLAUDE.md` 블록이 자동으로 만들어집니다(이미 있는 파일은 건드리지 않음). 원치 않으면 MODE 패널에서 끄면 되고, 끈 설정은 유지됩니다.
- **토큰 절감은 AOR 엔진이 있을 때만** 동작합니다(엔진이 터미널 출력을 정리·요약해 Claude에 들어가는 토큰을 줄이고 절감량을 기록). 엔진이 없으면 일반 셸로 열리고 상단 AOR 배지도 숨겨집니다.


좌측 **MODE** 패널에서 *"새 페인 AOR 모드로"* 체크 시, 이후 만들어지는 페인은 AOR routed PowerShell로 부팅됩니다. 이 모드에서 `claude` 호출은 자동으로 토큰 메트릭 기록 + Claude Workspace Trust prime이 적용됩니다.

> AOR 엔진 탐색 순서: ① 번들 `AOR/`(설치본은 `resources\AOR`) ② `settings.json`의 `aor.engineRoot` ③ `aor.engineRootCandidates` ④ `%USERPROFILE%\Desktop\WINDOWS\WINDOWS` 등 기본 위치. 엔진 루트에는 `engine\windows\_internal\shell-init.ps1`이 있어야 하며, 없으면 plain 셸로 폴백합니다.

### 5) AI DEV FLOW

좌측 **AI DEV FLOW** 패널에서 에이전트 개발 프로세스를 원클릭으로 세팅하고 실행합니다.

- **SETUP**: 선택한 프로젝트 폴더에 `agents/`, `logs/`, `backlog/`, `CLAUDE.md` 워크플로우를 생성합니다.
- **START**: 프로젝트 폴더로 이동한 뒤 Claude를 "agents/supervisor.md 절차대로 진행" 첫 프롬프트로 시작합니다 (코딩).
- **REVIEW**: Codex를 "agents/reviewer.md 규약으로 최근 변경 리뷰, logs/review/에 저장" 첫 프롬프트로 시작합니다.
- **MEDIA**: Grok을 "agents/media.md 규약으로 대기" 상태로 시작합니다. 이어서 "로고 이미지 2장 만들어줘"처럼 요청하면 `assets/generated/`에 만들고 `logs/media/`에 기록합니다. 스크립트로는 `scripts\run-media.ps1 -TaskId task-001 -Slug logo -Request "..."`.

> v0.1.0의 `claude < agents\supervisor.md` 방식은 PowerShell이 `<` 리디렉션을 지원하지 않아 실행되지 않았습니다. v0.2.0부터 첫 프롬프트 인자로 전달합니다.

SETUP이 만드는 문서의 원본은 `templates/aiops/`(supervisor.md · task-001.md · workflow.md · CLAUDE-block.md)와 `agents/`에 있습니다. 이 파일을 고치면 다음 SETUP부터 반영되며, 프로젝트에 이미 있는 파일은 덮어쓰지 않습니다.

생성되는 워크플로우는 Claude Code를 PM/코더, Codex를 리뷰어, Grok을 미디어 담당, `logs/`를 공유 메모리로 사용합니다. 큰 요청은 `backlog/task-XXX.md` 단위로 나누고, 리뷰와 미디어 결과는 각각 `logs/review/`, `logs/media/`(파일은 `assets/generated/`)에 남깁니다.

### 5-1) 이전 작업 이어하기

작업 중 앱이 꺼지거나(비정상 종료 포함) 다음 날 다시 열어도, 같은 프로젝트 폴더를 열면 AI DEV FLOW 아래에 **이전 작업 이어하기** 상자가 뜹니다.

- **이어하기**: 같은 탭/페인 배치로 열고, 각 페인에서 쓰던 CLI를 이어하기 옵션으로 다시 실행합니다 — `claude --continue`, `codex resume --last`, `grok --continue`. 대화 내용 자체는 각 CLI가 자기 기록에서 복원합니다.
- **새로 시작**: 이전 배치 기록을 지웁니다.

저장하는 것은 **배치·CLI 종류·마지막 backlog task·시각**뿐이고(프로젝트당 1~2KB, `사용자 데이터 폴더\history\`), 터미널 출력이나 입력한 내용은 저장하지 않습니다. 정리 규칙:

| 시점 | 정리 |
| --- | --- |
| 앱을 정상 종료할 때 | 가장 최근 세션만 배치를 남기고, 이전 세션은 한 줄 요약(시각·CLI·task)으로 줄임. 최대 5개 |
| 앱을 시작할 때 | 30일 넘게 안 연 프로젝트, 폴더가 사라진 프로젝트의 기록 삭제. 사라진 폴더는 최근 작업 폴더 목록에서도 제거 |
| 이어하기/새로 시작 후 | 이전 세션의 배치 정보 삭제 |

에이전트 로그도 필요한 것만 남깁니다: `run-reviewer.ps1`·`run-media.ps1`은 성공하면 원본 CLI 출력 로그를 지우고 보고서(`logs/review/*.md`, `logs/media/*.md`)만 남깁니다 (`-KeepLog`로 유지 가능, 실패 시에는 항상 유지).

### 5-2) 브라우저 모드 — 화면을 보면서 에이전트와 코딩

상단 **브라우저** 버튼을 누르면 **가운데에 브라우저, 오른쪽에 에이전트 터미널**이 열립니다.

| 기능 | 사용법 |
| --- | --- |
| 페이지 열기 | 주소창에 `localhost:3000` 같은 개발 서버 주소 → Enter (http/https만) |
| PC / 모바일 | **PC** · **모바일**(390×844, 모바일 UA, 터치) 전환 |
| 주석 | **📍 주석**을 켜고 문제 있는 요소를 클릭 → 번호 핀이 찍힘 (여러 개 가능, Esc로 끝) |
| 채팅 | 오른쪽 입력창에 "1번 버튼 눌러도 결제가 안 돼"처럼 적고 Enter |
| 콘솔 에러 | **콘솔** 배지에 에러 수(빨강 = 아직 안 보낸 새 에러), 누르면 목록. JS 에러·404/500 요청·로드 실패 포함 |

입력창으로 보낼 때 브라우저에 주석이나 새 콘솔 에러가 있으면 메시지 앞에 **[브라우저 컨텍스트]** 가 자동으로 붙습니다: URL, PC/모바일, 핀별 selector·텍스트·위치, 핀이 그려진 **화면 캡처 파일 경로**, 새 콘솔 에러(최대 8건). 보낸 주석은 지워지고, 에러는 "보냄"으로 표시됩니다.

- 브라우저는 앱과 분리된 **메모리 세션**이라 앱을 닫으면 쿠키·캐시가 남지 않습니다(로그인은 다시 해야 함). 권한 요청·다운로드는 막혀 있습니다.
- 캡처는 `<프로젝트>/.carrotcap/browser/`에 저장되고(폴더가 스스로 git에서 제외됨) **최근 20장 · 3일 이내**만 남깁니다.

### 6) 드래그앤드롭

좌측 폴더 트리(또는 검색 결과)에서 항목을 잡아 페인으로 떨어뜨리면 그 경로가 활성 셸의 입력 라인에 자동으로 추가됩니다.

### 7) 파일 검색

사이드바의 *파일 검색* 입력창에 단어를 치면 폴더 안의 파일/디렉터리를 평면 결과로 보여줍니다 (최대 200개).

### 8) AOR 컨텍스트 편집

상단 우측의 **AOR** 버튼 → 인-앱 에디터로 사용자 데이터 폴더의 `CLAUDE.md`(디폴트 컨텍스트)를 즉시 편집·저장 (512KB 이하).

### 9) 설정 파일 위치

사용자가 바꾸는 파일은 코드 폴더가 아니라 **사용자 데이터 폴더**에 저장됩니다. 첫 실행 때 번들 기본값(`settings.json`, `CLAUDE.md`)을 복사하고, 이후에는 덮어쓰지 않습니다.

| 실행 방식 | 위치 |
| --- | --- |
| 설치본 | `%APPDATA%\carrotcap-cli\` |
| 개발 (`npm start`) | `%APPDATA%\carrotcap-cli-dev\` |

폴더 안의 파일: `settings.json`(AOR/CLI/UI), `CLAUDE.md`(AOR 컨텍스트), `workspace-state.json`(허용된 작업 폴더 목록 — 앱만 씀). 초기화하려면 앱을 끄고 해당 파일을 지우세요.

---

## 디렉터리 구조

```
.
├─ main.js          Electron 메인 — PTY/IPC/폴더/세팅
├─ preload.js       contextBridge 경유 IPC API
├─ index.html       UI 셸
├─ renderer.js      탭/페인/사이드바/터미널/드래그앤드롭
├─ styles.css       다크 테마
├─ CLAUDE.md        번들 디폴트 AOR 컨텍스트 (첫 실행 시 사용자 폴더로 복사)
├─ settings.json    번들 디폴트 설정 (첫 실행 시 사용자 폴더로 복사)
├─ agents/          reviewer.md(Codex) / media.md(Grok) — AIOps 템플릿 겸 이 저장소의 에이전트 규약
├─ templates/aiops/ AIOps SETUP이 프로젝트에 복사하는 문서 원본
├─ backlog/         task-XXX.md 작업 단위
├─ logs/            review/ · media/ 에이전트 산출물 (공유 메모리, research/는 v0.1 기록)
├─ scripts/         setup-dev · run-reviewer · run-media · 테스트
├─ AOR/             번들 AOR 엔진 (extraResources)
└─ build/           NSIS / pkg 설치 스크립트
```

---

## 트러블슈팅

| 증상 | 원인 / 해결 |
| --- | --- |
| PTY가 폴백 모드로 동작 | 프리빌트 바이너리 ABI 불일치. `npm run rebuild` (Visual Studio Build Tools 필요). 폴백 모드에서도 동작은 합니다 (`window.carrotcap.ptyAvailable()` 가 false). |
| `node_modules` 안의 파일이 일부 없음 | Google Drive 동기화 도중 손상된 경우입니다. `scripts\setup-dev.ps1`을 다시 실행하세요. |
| 새 PowerShell에서 `carrotcap : 인식되지 않습니다` | `release\*.exe`로 **설치 단계**를 안 거친 경우입니다. 설치 후 새 셸을 열어 다시 실행. 또는 `powershell -ExecutionPolicy Bypass -File scripts\repair-cli.ps1` 로 수동 등록. 패키지된 GUI를 한 번만 실행해도 자동 자가복구됩니다. |
| AOR 모드에서 즉시 종료 | `settings.json` → `aor.engineRoot` 경로가 실제 AOR 엔진 루트인지 확인. 그 안에 `engine\windows\_internal\shell-init.ps1`이 있어야 합니다. |
| `claude`/`codex`/`grok` 명령을 찾을 수 없음 (버튼 취소선) | 해당 CLI를 설치하고 PATH에 등록한 뒤 앱을 다시 여세요. `cli.<key>.command`에는 보안상 명령 이름만 허용됩니다(경로·공백 불가). |
| 한글 폴더 경로에서 깨짐 | PowerShell이 UTF-8을 사용하도록 `chcp 65001`이 자동 호출됩니다. 그래도 깨지면 코드페이지를 확인하세요. |

---

## 원칙 (이 프로젝트의 운영 규칙)

이 앱은 **AOR(Agent-Output-Router) + 사용자 운영규칙(CLAUDE.md)** 두 가지 축으로 동작합니다. 자세한 운영 규칙은 `CLAUDE.md`를 확인하세요.
