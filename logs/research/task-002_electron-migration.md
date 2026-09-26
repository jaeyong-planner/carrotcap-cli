Warning: True color (24-bit) support not detected. Using a terminal with true color enabled will result in a better visual experience.
Ripgrep is not available. Falling back to GrepTool.
(node:18676) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
(Use `node --trace-deprecation ...` to show where the warning was created)
GrepLogic: Error in performGrepSearch (Strategy: javascript fallback): This operation was aborted
Error during GrepLogic execution: Error: Operation timed out after 30000ms. In large repositories, consider narrowing your search scope by specifying a 'dir_path' or an 'include_pattern'.
Error executing tool grep_search: Error: Operation timed out after 30000ms. In large repositories, consider narrowing your search scope by specifying a 'dir_path' or an 'include_pattern'.
# Research Report — Electron 27.3.11 -> Latest Migration

## 1. 조사 대상
- 대상 라이브러리/주제: **Electron** (메인 프레임워크 및 관련 생태계)
- 현재 프로젝트 사용 버전: `electron@27.3.11`, `@homebridge/node-pty-prebuilt-multiarch@^0.11.14`, `electron-builder@^24.13.3`
- 조사 시점: 2026-05-06
- 대상 마이그레이션 버전: **Electron v42.0.0** (2026-05-05 출시 최신 안정 버전)

## 2. 핵심 변경사항
v28부터 v42까지의 주요 Breaking Changes 및 변경 사항은 다음과 같습니다.

### **v28 ~ v29**
- **IPC 제한 (v29):** `contextBridge`를 통해 `ipcRenderer` 모듈 전체를 노출하는 것이 완전히 차단되었습니다. (현재 프로젝트는 개별 함수 노출 방식으로 안전함)
- **File API (v29):** `File.path` 속성이 비표준으로 간주되어 사용이 중단되었습니다. 대신 `webUtils.getPathForFile(file)` 사용이 권장됩니다.
- **이벤트 제거 (v29):** `renderer-process-crashed`, `gpu-process-crashed` 등의 이벤트가 제거되고 `render-process-gone`, `child-process-gone`으로 통합되었습니다.

### **v30 ~ v32**
- **BrowserView 대체 (v30):** `BrowserView` API가 Deprecated 되었으며, 새로운 **`WebContentsView`**와 `BaseWindow` API로 대체되었습니다.
- **File.path 제거 (v32):** v29에서 예고된 대로 `File.path`가 완전히 제거되었습니다. 렌더러에서 드래그 앤 드롭 파일 경로를 읽을 때 반드시 `webUtils`를 거쳐야 합니다.
- **Navigation API (v32):** `WebContents.goBack()` 등이 Deprecated 되고 `navigationHistory` API로 통합되었습니다.

### **v33 ~ v39**
- **런타임 업데이트:** v33(Node.js 20.18), v34(Node.js 22.11). 네이티브 모듈 컴파일 시 **C++20**이 최소 요구 사양입니다.
- **OS 지원 종료 (v33):** macOS 10.15 (Catalina) 지원이 종료되었습니다. (최소 macOS 11 Big Sur 필요)

### **v40 ~ v42 (최신)**
- **Clipboard API 제한 (v40):** 렌더러 프로세스에서 `clipboard` API 직접 접근이 제한됩니다. Preload를 통한 IPC 통신이 권장됩니다.
- **Node.js 메이저 업데이트 (v42):** **Node.js 24.15.0** 및 **Chromium 148** 탑재. 대규모 V8 엔진 변경으로 네이티브 모듈(`node-pty`)의 재빌드가 필수적입니다.

## 3. 현재 프로젝트 영향도
- **@homebridge/node-pty-prebuilt-multiarch (High):**
    - Electron v42의 Node.js v24 ABI와 호환되는 바이너리가 필요합니다.
    - 현재 사용하는 prebuilt 버전이 Node 24를 지원하지 않을 경우, 직접 컴파일하거나 지원 버전으로 업데이트해야 합니다.
- **renderer.js (Medium):**
    - 드래그 앤 드롭 구현부(Line 183)에서 `e.dataTransfer.files[0].path`를 사용 중입니다. v32 이상에서는 작동하지 않으므로 수정이 필수입니다.
- **BrowserWindow webPreferences (Low):**
    - 현재 `sandbox: false`를 사용 중이나, 최신 버전에서는 보안을 위해 `sandbox: true`를 강하게 권장합니다. 활성화 시 `require` 사용이 제한되므로 IPC 구조 조정이 필요할 수 있습니다.
- **electron-builder (Medium):**
    - `^24.13.3` 버전은 Electron v42의 새로운 메타데이터나 빌드 타겟을 지원하지 않을 수 있으므로 v25+ 버전으로 업데이트가 권장됩니다.

## 4. 수정이 필요한 파일 후보
- **package.json:** `electron` 버전을 `42.0.0`으로 업데이트하고, `devDependencies`의 `@electron/rebuild` 및 `electron-builder` 버전 상향 필요.
- **preload.js:** 렌더러에서 사용할 수 있도록 `webUtils.getPathForFile`을 노출하는 브릿지 함수 추가 필요.
- **renderer.js:** 드래그 앤 드롭 이벤트 핸들러(`drop` 이벤트)에서 `file.path` 대신 `window.carrotcap.getPathForFile(file)`을 호출하도록 수정.
- **main.js:** `app.on('render-process-gone')` 등을 사용하여 최신 프로세스 종료 처리 로직 도입 검토.

## 5. 참고 문서 또는 근거
- [Electron 공식 릴리즈 노트 (v28-v42)](https://www.electronjs.org/releases/stable) (공식)
- [Electron Breaking Changes 일람](https://www.electronjs.org/docs/latest/breaking-changes) (공식)
- [Node.js v24 릴리즈 정보](https://nodejs.org/en/blog/release) (공식)
- 신뢰도: **공식 (High)**

## 6. 주의사항
- **node-pty 호환성:** Node.js 24(V8 최신 버전) 도입으로 인해 기존 `node-pty` 바이너리가 로드되지 않을 가능성이 매우 높습니다. 마이그레이션 시 가장 먼저 `npm run rebuild`를 통해 로컬 환경 컴파일 성공 여부를 확인해야 합니다.
- **WebSQL 제거:** 만약 숨겨진 의존성에서 WebSQL을 사용 중이라면 v31 이후로 동작하지 않습니다.
- **macOS 빌드:** 최신 Electron 버전은 macOS 코드 사인 및 공증(Notarization) 요건이 엄격해졌으므로 빌드 파이프라인 확인이 필요합니다.
- > ⚠️ 확인 필요: 현재 사용 중인 `@homebridge/node-pty-prebuilt-multiarch` 레포지토리가 Node 24용 prebuilt 바이너리를 배포 중인지 확인이 필요합니다. 배포 전이라면 일반 `node-pty`로 전환하고 `electron-rebuild`를 강제하는 전략을 고려해야 합니다.
