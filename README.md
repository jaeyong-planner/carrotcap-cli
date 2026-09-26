# 🥕 CARROTCAP CLI

AOR 라우팅이 디폴트로 적용된 데스크톱 터미널.  
**탭 + 분할(LEFT/RIGHT/UP/DOWN) + 폴더 사이드바 + 드래그앤드롭 + CLAUDE/GEMINI/CODEX 원-클릭 호출**.

---

## 설치 (Windows)

선결 조건 — Node.js 18+ 그리고 **Visual Studio Build Tools (Desktop Development with C++)**가 필요합니다.  
Node.js 설치 시 *Tools for Native Modules* 옵션을 체크했다면 이미 갖추어져 있습니다.

```powershell
cd "C:\Users\carro\Documents\Claude\Projects\터미널 CLI 만들기"
npm install
npm start
```

> `postinstall`에서 `electron-rebuild`가 실행됩니다. 빌드 도구가 없을 경우 자동으로 스킵되며, 이 경우 PTY는 폴백 모드(child_process)로 동작합니다.

---

## 사용법

### 1) 폴더 선택

좌측 사이드바 상단의 📁 버튼 → 작업 폴더 선택. 이후 새 페인은 그 폴더에서 시작합니다.

### 2) 탭 / 분할

- **상단 ＋ 버튼** 또는 `Ctrl+T` → 새 탭.
- 좌측 **SPLIT 패널** 또는 `Ctrl+Shift+→/←/↑/↓` → RIGHT/LEFT/UP/DOWN 분할.
- 분할 사이의 회색 바를 드래그해서 비율 조절.

### 3) CLI 원-클릭

좌측 **QUICK CLI** 패널에서 CLAUDE / GEMINI / CODEX 클릭 → 활성 페인에 명령이 입력되어 즉시 실행됩니다. 명령은 `settings.json`의 `cli` 섹션에서 자유롭게 바꿀 수 있습니다.

### 4) AOR 모드

좌측 **MODE** 패널에서 *"새 페인 AOR 모드로"* 체크 시, 이후 만들어지는 페인은 AOR routed PowerShell로 부팅됩니다. 이 모드에서 `claude` 호출은 자동으로 토큰 메트릭 기록 + Claude Workspace Trust prime이 적용됩니다.

> AOR 엔진의 위치는 `settings.json`의 `aor.engineRoot`로 지정합니다. 기본값: `C:\Users\carro\Desktop\WINDOWS\WINDOWS`.

### 5) AI DEV FLOW

좌측 **AI DEV FLOW** 패널에서 에이전트 개발 프로세스를 원클릭으로 세팅하고 실행합니다.

- **SETUP**: 선택한 프로젝트 폴더에 `agents/`, `logs/`, `backlog/`, `CLAUDE.md` 워크플로우를 생성합니다.
- **START**: 선택한 프로젝트 폴더로 이동한 뒤 `claude < agents\supervisor.md`를 실행합니다.
- **RESEARCH**: `gemini < agents\researcher.md`로 조사 절차를 실행합니다.
- **REVIEW**: `codex < agents\reviewer.md`로 코드 리뷰 절차를 실행합니다.

생성되는 워크플로우는 Claude Code를 PM/코더, Gemini를 리서처, Codex를 리뷰어, `logs/`를 공유 메모리로 사용합니다. 큰 요청은 `backlog/task-XXX.md` 단위로 나누고, 리서치와 리뷰 결과는 각각 `logs/research/`, `logs/review/`에 남기는 방식입니다.

### 6) 드래그앤드롭

좌측 폴더 트리(또는 검색 결과)에서 항목을 잡아 페인으로 떨어뜨리면 그 경로가 활성 셸의 입력 라인에 자동으로 추가됩니다.

### 7) 파일 검색

사이드바의 *파일 검색* 입력창에 단어를 치면 폴더 안의 파일/디렉터리를 평면 결과로 보여줍니다 (최대 200개).

### 8) AOR 컨텍스트 편집

상단 우측의 **AOR** 버튼 → 인-앱 에디터로 `CLAUDE.md`(이 앱 루트의 디폴트 컨텍스트)를 즉시 편집·저장.

---

## 디렉터리 구조

```
.
├─ main.js          Electron 메인 — PTY/IPC/폴더/세팅
├─ preload.js       contextBridge 경유 IPC API
├─ index.html       UI 셸
├─ renderer.js      탭/페인/사이드바/터미널/드래그앤드롭
├─ styles.css       다크 테마
├─ CLAUDE.md        디폴트 AOR 컨텍스트(편집 가능)
├─ settings.json    AOR/CLI/UI 설정(편집 가능)
└─ package.json
```

---

## 트러블슈팅

| 증상 | 원인 / 해결 |
| --- | --- |
| `npm install` 중 native build 실패 | Visual Studio Build Tools 설치. 그래도 실패하면 폴백 모드로 동작은 됩니다 (`window.carrotcap.ptyAvailable()` 가 false). |
| 새 PowerShell에서 `carrotcap : 인식되지 않습니다` | `release\*.exe`로 **설치 단계**를 안 거친 경우입니다. 설치 후 새 셸을 열어 다시 실행. 또는 `powershell -ExecutionPolicy Bypass -File scripts\repair-cli.ps1` 로 수동 등록. 패키지된 GUI를 한 번만 실행해도 자동 자가복구됩니다. |
| AOR 모드에서 즉시 종료 | `settings.json` → `aor.engineRoot` 경로가 실제 AOR 엔진 루트인지 확인. 그 안에 `engine\windows\_internal\shell-init.ps1`이 있어야 합니다. |
| `claude`/`gemini`/`codex` 명령을 찾을 수 없음 | 해당 CLI가 PATH에 등록되어 있어야 합니다. 또는 `settings.json`의 `cli.<key>.command`를 절대경로로 지정. |
| 한글 폴더 경로에서 깨짐 | PowerShell이 UTF-8을 사용하도록 `chcp 65001`이 자동 호출됩니다. 그래도 깨지면 코드페이지를 확인하세요. |

---

## 원칙 (이 프로젝트의 운영 규칙)

이 앱은 **AOR(Agent-Output-Router) + 사용자 운영규칙(CLAUDE.md)** 두 가지 축으로 동작합니다. 자세한 운영 규칙은 `CLAUDE.md`를 확인하세요.
