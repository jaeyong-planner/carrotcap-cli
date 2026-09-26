# 🥕 CARROTCAP CLI

AOR 라우팅이 디폴트로 적용된 데스크톱 터미널.  
**탭 + 분할(LEFT/RIGHT/UP/DOWN) + 폴더 사이드바 + 드래그앤드롭 + CLAUDE/GEMINI/CODEX 원-클릭 호출**.

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
| `npm run test:smoke` | 실제 앱을 띄워 CDP로 점검 (sandbox · PTY · 악성 IPC · CLAUDE.md · 클립보드) |
| `npm run pack` | 설치 없이 `release/win-unpacked/` 생성 |
| `npm run dist:win` | NSIS 설치 파일 생성 (`release/CARROTCAP-CLI-<ver>-win-x64.exe`) |

> AOR 엔진 바이너리(`AOR/engine/**/bin/`, 약 85MB)는 git에 포함되지 않습니다. 빌드 전 해당 위치에 직접 배치하세요.

---

## 사용법

### 1) 폴더 선택

좌측 사이드바 상단의 📁 버튼 → 작업 폴더 선택. 이후 새 페인은 그 폴더에서 시작합니다.

### 2) 탭 / 분할

- **상단 ＋ 버튼** 또는 `Ctrl+T` → 새 탭.
- 좌측 **SPLIT 패널** 또는 `Ctrl+Shift+→/←/↑/↓` → RIGHT/LEFT/UP/DOWN 분할.
- 분할 사이의 회색 바를 드래그해서 비율 조절.

**복사 / 붙여넣기**

| 동작 | 단축키 |
| --- | --- |
| 복사 | 드래그 선택 후 `Ctrl+C` (선택이 없으면 평소처럼 중단 신호) 또는 `Ctrl+Shift+C` |
| 붙여넣기 | `Ctrl+Shift+V` 또는 `Shift+Insert` (`Ctrl+V`는 셸/CLI 기본 동작 유지) |
| 메뉴 | 터미널 우클릭 → 복사 · 붙여넣기 · 모두 선택 · 화면 지우기 |

### 3) CLI 원-클릭

좌측 **QUICK CLI** 패널에서 CLAUDE / GEMINI / CODEX 클릭 → 활성 페인에 명령이 입력되어 즉시 실행됩니다. 명령은 사용자 `settings.json`(아래 9번)의 `cli` 섹션에서 자유롭게 바꿀 수 있습니다.

### 4) AOR 모드

좌측 **MODE** 패널에서 *"새 페인 AOR 모드로"* 체크 시, 이후 만들어지는 페인은 AOR routed PowerShell로 부팅됩니다. 이 모드에서 `claude` 호출은 자동으로 토큰 메트릭 기록 + Claude Workspace Trust prime이 적용됩니다.

> AOR 엔진 탐색 순서: ① 번들 `AOR/`(설치본은 `resources\AOR`) ② `settings.json`의 `aor.engineRoot` ③ `aor.engineRootCandidates` ④ `%USERPROFILE%\Desktop\WINDOWS\WINDOWS` 등 기본 위치. 엔진 루트에는 `engine\windows\_internal\shell-init.ps1`이 있어야 하며, 없으면 plain 셸로 폴백합니다.

### 5) AI DEV FLOW

좌측 **AI DEV FLOW** 패널에서 에이전트 개발 프로세스를 원클릭으로 세팅하고 실행합니다.

- **SETUP**: 선택한 프로젝트 폴더에 `agents/`, `logs/`, `backlog/`, `CLAUDE.md` 워크플로우를 생성합니다.
- **START**: 선택한 프로젝트 폴더로 이동한 뒤 `claude < agents\supervisor.md`를 실행합니다.
- **RESEARCH**: `gemini < agents\researcher.md`로 조사 절차를 실행합니다.
- **REVIEW**: `codex < agents\reviewer.md`로 코드 리뷰 절차를 실행합니다.

SETUP이 만드는 문서의 원본은 `templates/aiops/`(supervisor.md · task-001.md · workflow.md · CLAUDE-block.md)와 `agents/`에 있습니다. 이 파일을 고치면 다음 SETUP부터 반영되며, 프로젝트에 이미 있는 파일은 덮어쓰지 않습니다.

생성되는 워크플로우는 Claude Code를 PM/코더, Gemini를 리서처, Codex를 리뷰어, `logs/`를 공유 메모리로 사용합니다. 큰 요청은 `backlog/task-XXX.md` 단위로 나누고, 리서치와 리뷰 결과는 각각 `logs/research/`, `logs/review/`에 남기는 방식입니다.

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
├─ agents/          researcher.md / reviewer.md (AIOps 템플릿 겸 이 저장소의 에이전트 규약)
├─ templates/aiops/ AIOps SETUP이 프로젝트에 복사하는 문서 원본
├─ backlog/         task-XXX.md 작업 단위
├─ logs/            research/ · review/ 에이전트 산출물 (공유 메모리)
├─ scripts/         setup-dev · run-researcher · run-reviewer · 테스트
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
| `claude`/`gemini`/`codex` 명령을 찾을 수 없음 | 해당 CLI가 PATH에 등록되어 있어야 합니다. 또는 `settings.json`의 `cli.<key>.command`를 절대경로로 지정. |
| 한글 폴더 경로에서 깨짐 | PowerShell이 UTF-8을 사용하도록 `chcp 65001`이 자동 호출됩니다. 그래도 깨지면 코드페이지를 확인하세요. |

---

## 원칙 (이 프로젝트의 운영 규칙)

이 앱은 **AOR(Agent-Output-Router) + 사용자 운영규칙(CLAUDE.md)** 두 가지 축으로 동작합니다. 자세한 운영 규칙은 `CLAUDE.md`를 확인하세요.
