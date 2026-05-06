# 🥕 CARROTCAP CLI

데스크톱 터미널 — **탭 + 분할(LEFT/RIGHT/UP/DOWN) + 폴더 사이드바 + 드래그앤드롭 + Quick CLI(CLAUDE/GEMINI/CODEX)**.

![status](https://img.shields.io/badge/platform-Windows-blue) ![license](https://img.shields.io/badge/license-MIT-green)

---

## 일반 사용자용 — 가장 빠른 시작

> 빌드 도구·Node.js·Python 등 **아무것도 깔 필요 없습니다.** EXE만 설치하면 끝.

### 1. 설치 EXE 다운로드

[Releases 페이지](https://github.com/carrotcap/carrotcap-cli/releases/latest)에서 `CARROTCAP-CLI-<version>-win-x64.exe` 를 다운로드합니다.

### 2. 더블클릭 → 설치

Windows 보안 경고가 뜨면 *추가 정보* → *실행*을 선택합니다 (코드 사이닝 미적용 상태).

설치가 끝나면 다음이 자동으로 셋업됩니다:
- 시작 메뉴와 바탕화면에 **CARROTCAP CLI** 아이콘 등록
- PowerShell에서 `carrotcap` 명령어 즉시 사용 가능 (`%LOCALAPPDATA%\Microsoft\WindowsApps\carrotcap.cmd` 자동 생성)
- 첫 실행 시 `settings.json` 자동 생성 (PowerShell 절대경로 자동 탐지)
- node-pty 네이티브 바이너리는 EXE 안에 포함되어 있어 **사용자 PC에서 컴파일 안 함**

### 3. 실행

세 가지 방법 중 아무거나:
- 시작 메뉴 → "CARROTCAP CLI"
- 바탕화면 아이콘 더블클릭
- PowerShell에서 `carrotcap` 입력

---

## 기본 사용법

### 폴더 선택

좌측 사이드바 상단 📁 버튼 → 작업 폴더 선택. 이후 새 페인은 그 폴더에서 시작합니다. 한 번 선택한 폴더는 자동으로 기억됩니다.

### 탭과 분할

| 동작 | 단축키 / 버튼 |
|---|---|
| 새 탭 | 상단 ＋ 버튼 또는 `Ctrl+T` |
| 페인 분할 (좌/우/상/하) | 좌측 SPLIT 패널 4개 버튼 또는 `Ctrl+Shift+←/→/↑/↓` |
| 활성 페인 닫기 | 페인 우상단 ✕ 버튼 또는 `Ctrl+W` |
| 분할 비율 조정 | 분할선(회색 바) 드래그 |

### Quick CLI (원-클릭 실행)

좌측 **QUICK CLI** 패널에서 CLAUDE / GEMINI / CODEX 버튼 클릭 → 활성 페인에 명령이 입력되어 즉시 실행됩니다. 명령은 `settings.json`의 `cli` 섹션에서 자유롭게 바꿀 수 있습니다.

### 드래그앤드롭

좌측 폴더 트리(또는 검색 결과)에서 항목을 잡아 페인으로 떨어뜨리면 그 경로가 활성 셸 입력 라인에 자동 추가됩니다. 공백·특수문자가 있으면 자동으로 큰따옴표로 감쌉니다.

### 파일 검색

사이드바 *파일 검색* 입력창에 단어를 치면 작업 폴더 안의 파일/디렉터리를 평면 결과로 보여줍니다 (최대 200개).

### 클립보드 단축키

| 동작 | 단축키 |
|---|---|
| 복사 (활성 페인의 선택 텍스트) | `Ctrl+Shift+C` |
| 붙여넣기 (PTY로 텍스트 입력) | `Ctrl+Shift+V` |

---

## 헬스체크

설치 후 정상 동작 여부를 한 번에 확인하려면:

```powershell
cd "$env:LOCALAPPDATA\Programs\CARROTCAP CLI"
powershell -ExecutionPolicy Bypass -File resources\app\scripts\healthcheck.ps1 -Verbose
```

(개발 빌드의 경우엔 `cd C:\carrotcap-cli; powershell -ExecutionPolicy Bypass -File scripts\healthcheck.ps1 -Verbose`)

체크 항목:
- Node.js / npm 존재 (개발 빌드만)
- node_modules 존재 + electron require 가능
- node-pty 가용 (PTY 모드)
- xterm CSS 정상 로드
- `carrotcap` 명령 PATH 등록
- 렌더러 드래그앤드롭 wiring
- main.js 자기참조 kill 안전성

`Result: N passed`로 끝나야 정상입니다.

---

## 트러블슈팅

| 증상 | 해결 |
|---|---|
| 타이핑이 안 되거나 한 글자가 아니라 줄 전체가 지워짐 | PTY 미가용 상태입니다. `scripts\fix-pty.ps1` 한 번 실행. EXE 설치본은 이 문제가 없어야 합니다. |
| 페인 헤더에 노란 `(no-PTY)` 표시 | 위와 동일 — `fix-pty.ps1` 실행. |
| `carrotcap` 명령이 인식 안 됨 | PowerShell을 새로 열어 보세요(설치 직후엔 PATH 캐시 갱신 필요). 그래도 안 되면 `%LOCALAPPDATA%\Microsoft\WindowsApps`가 PATH에 있는지 확인. |
| Quick CLI 버튼 클릭 시 "command not found" | 해당 CLI(`claude`, `gemini`, `codex`)가 PATH에 등록되어 있어야 합니다. 또는 `settings.json`의 `cli.<key>.command`를 절대경로로 지정. |
| 폴더 아이콘 클릭 무반응 | DevTools 열기(메뉴 → View → Toggle DevTools) → Console 탭 에러 확인 후 이슈로 보고. |
| 한글 경로 깨짐 | Windows 11 22H2+ 권장. cmd가 아니라 PowerShell이 떠야 정상 — 페인 헤더 라벨이 `PLAIN`이고 cmd 배너(`Microsoft Windows [Version ...]`)가 안 보이면 OK. |

---

## 단축키 모음

| 키 | 동작 |
|---|---|
| `Ctrl+T` | 새 탭 |
| `Ctrl+W` | 활성 페인 닫기 |
| `Ctrl+Shift+→` | 우측 분할 |
| `Ctrl+Shift+←` | 좌측 분할 |
| `Ctrl+Shift+↑` | 상단 분할 |
| `Ctrl+Shift+↓` | 하단 분할 |
| `Ctrl+Shift+C` | 복사 |
| `Ctrl+Shift+V` | 붙여넣기 |

---

## 설정 파일

`settings.json` (앱 설치 폴더 또는 개발 빌드 루트):

```json
{
  "cli": {
    "claude": { "command": "claude", "args": [] },
    "gemini": { "command": "gemini", "args": [] },
    "codex":  { "command": "codex",  "args": [] }
  },
  "defaultShell": "powershell.exe",
  "defaultProjectPath": "",
  "ui": {
    "theme": "dark",
    "fontSize": 14,
    "fontFamily": "Cascadia Code, Consolas, monospace"
  }
}
```

`cli.<name>.args`에 옵션을 추가하면 Quick CLI 버튼 한 번에 그 옵션까지 함께 실행됩니다. 예: `claude.args = ["--dangerously-skip-permissions"]`.

---

# 개발자용 — 소스에서 빌드

여기부터는 직접 코드를 받아 빌드·기여하시려는 분들을 위한 섹션입니다. 일반 사용자는 위까지만 보시면 됩니다.

## 선결 조건

- **Node.js 18 LTS 이상** (https://nodejs.org)
- **Visual Studio Build Tools 2022** + 다음 워크로드/구성요소:
  - C++를 사용한 데스크톱 개발 (MSVC v143)
  - C++ Clang Compiler for Windows + MSBuild support for LLVM (clang-cl) toolset (node-pty 빌드에 필요)
- **Python 3.10+** (PATH에 등록)

이 셋이 모두 갖춰져 있어야 `node-pty`가 정상 빌드됩니다.

## 클론 & 실행

```powershell
git clone https://github.com/carrotcap/carrotcap-cli.git
cd carrotcap-cli
npm install
npm start
```

만약 `npm install`이 node-pty 빌드에서 실패하면:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\fix-pty.ps1
```

이 스크립트가 진단 → 누락분 설치 → Electron ABI에 맞춰 rebuild → require 검증까지 한 번에 수행합니다.

## 인스톨러 빌드 (Windows EXE)

```powershell
.\build-installer.bat
```

산출물: `release\CARROTCAP-CLI-<version>-win-x64.exe`

이 EXE는 다음을 포함합니다:
- Electron 28 런타임
- 사전 빌드된 node-pty 네이티브 바이너리 (asarUnpack)
- 모든 앱 소스 + xterm 라이브러리

→ 사용자 PC에서 **추가 컴파일 없이** 동작합니다.

## 디렉토리 구조

```
.
├─ main.js                Electron main process — PTY/IPC/folder/settings
├─ preload.js             contextBridge IPC bridge
├─ index.html             UI shell
├─ renderer.js            tabs / panes / sidebar / xterm / drag&drop
├─ styles.css             dark theme
├─ settings.json          CLI / UI settings (auto-generated on first run)
├─ package.json
├─ start.bat              Windows launcher (with idempotent install + PTY auto-repair)
├─ build-installer.bat    NSIS installer build entry
├─ build/
│  ├─ installer.nsh       NSIS hooks (carrotcap.cmd shim creation)
│  └─ pkg-scripts/        macOS pkg postinstall
├─ scripts/
│  ├─ healthcheck.ps1     Integrated health check
│  └─ fix-pty.ps1         node-pty repair
└─ LICENSE                MIT
```

## 디버깅

DevTools: 메뉴 → View → Toggle DevTools (또는 `Ctrl+Shift+I`).

페인 헤더에 노란 `(no-PTY)`가 보이면 child_process 폴백 모드입니다. `fix-pty.ps1`로 PTY를 살리세요.

## 기여

Pull Request 환영합니다. 코드 변경 후 다음을 통과해야 합니다:

1. `node --check main.js renderer.js preload.js` — syntax OK
2. `powershell -ExecutionPolicy Bypass -File scripts\healthcheck.ps1` — 모든 항목 PASS
3. `npm start` 후 키 입력·Backspace·드래그앤드롭·Quick CLI 동작 확인

## 라이선스

MIT — 자세한 내용은 [LICENSE](./LICENSE) 참고.
