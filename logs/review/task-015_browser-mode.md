# Review Report — task-015 browser mode

## 1. 리뷰 대상

- 파일/모듈 목록: `main-browser.js`, `renderer-browser.js`, `main.js`, `preload.js`, `renderer.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`, `scripts/lib/cdp-app.js`
- 변경 라인 수: 9개 파일, 856 additions / 30 deletions (총 886 변경 라인)
- 리뷰 시점: 2026-09-26T15:29:33Z

## 2. 전체 판단

- ❌ 반려
- BrowserView 기본 격리와 trusted-sender IPC는 적절하지만, redirect 기반 `file:` 접근, 심볼릭 링크를 통한 캡처 파일 삭제, 페이지 문자열의 PTY command injection 가능성을 먼저 수정해야 합니다.

## 3. Critical 이슈

- [main-browser.js:195] `will-navigate`만 검증하고 `will-redirect`를 차단하지 않아, 허용된 `http(s)` URL이 서버 30x redirect를 통해 `file:` 등 비허용 scheme으로 이동할 수 있습니다. BrowserView는 preload/Node가 없더라도 로컬 파일을 읽거나 외부로 유출할 수 있으므로, `will-redirect`에서 `normalizeUrl(url)` 실패 시 `preventDefault()`하고, `did-navigate` 후 scheme도 방어적으로 확인해야 합니다.

- [main-browser.js:256] 프로젝트 루트만 `resolveAllowedDir()`로 검증하고 `.carrotcap` 및 `browser` 하위 경로의 symlink 여부는 검증하지 않습니다. 악성/신뢰할 수 없는 프로젝트가 `.carrotcap/browser`를 외부 디렉터리로 연결하면 [main-browser.js:261]의 `.gitignore` 쓰기와 [main-browser.js:276]의 오래된 `shot-*.png` 삭제가 workspace 밖에서 수행될 수 있습니다. 생성 전 각 경로 구성요소를 `lstat`/`realpath`로 검사하고 최종 realpath가 허용 workspace 내부임을 보장해야 합니다.

- [main-browser.js:158] 페이지가 제어하는 console message/source가 control character·개행 제거 없이 보존되고, [renderer-browser.js:181]의 title·URL 및 [renderer-browser.js:192]의 오류 문자열이 그대로 컨텍스트에 결합된 뒤 [renderer.js:708]에서 PTY로 paste됩니다. 악성 페이지가 newline, ESC/C1 control character를 포함한 title 또는 `console.error()`를 만들면 shell/CLI가 multiline paste를 명령으로 처리할 수 있습니다. 각 페이지 유래 필드를 서버 측에서 single-line printable text로 정규화하고 C0, DEL, C1 control character를 제거/이스케이프한 뒤에만 PTY 컨텍스트를 만들도록 수정해야 합니다.

## 4. Major 이슈

- [main-browser.js:172] 고정 partition session을 다시 사용할 때마다 permission/download/webRequest listener를 재등록하지만, [main-browser.js:242]의 `destroyView()`는 이를 해제하지 않습니다. 브라우저를 반복해서 열고 닫으면 stale closure와 listener가 누적되고, 이후 네트워크 오류 처리와 상태 전송이 중복되거나 이전 view 상태를 참조할 수 있습니다. session별 listener를 한 번만 등록하거나 view 종료 시 명시적으로 제거해야 합니다.

- [main.js:1170] 메인 창 종료 시 BrowserView 정리 함수가 호출되지 않으며, [main.js:1515]에서 `setupBrowser()` 반환값도 버려집니다. macOS 등에서 창을 닫았다가 `activate`로 새 창을 만들면 폐기된 BrowserView 참조가 남아 새 창에 재부착되지 않을 수 있습니다. 반환된 `destroyView`를 보관하고 `mainWindow.closed`에서 호출해야 합니다.

- [renderer-browser.js:196] `decorate()`가 screenshot/errors를 확보한 즉시 pin과 원격 overlay를 삭제하고 errors를 reported 처리합니다. 이후 [renderer.js:706]에서 PTY가 종료된 것을 발견하면 입력 텍스트만 복구하므로, 주석·스크린샷·새 오류는 유실됩니다. PTY 전달 성공이 확인된 뒤에만 context를 consume하도록 commit 단계를 분리해야 합니다.

- [renderer-browser.js:165] 페이지 URL 변경을 감지했을 때 loading 중이면 annotation loop 재시작을 건너뜁니다. 이후 `did-stop-loading` state는 URL이 이미 같아 조건에 다시 진입하지 않으므로, 기존 pick이 navigation으로 `null`을 반환하면 [renderer-browser.js:105]에서 annotation mode가 종료됩니다. navigation generation을 별도로 증가시키고 load 완료 시 annotation overlay를 재설치해야 합니다.

- [renderer-browser.js:63] `browserOpen()`이 await 중인 상태에서 사용자가 browser mode를 끄면, [renderer-browser.js:70]은 완료된 오래된 요청의 결과로 `st.open = true`를 다시 설정할 수 있습니다. main 쪽 view는 이미 닫혀 있으므로 다음 toggle에서 renderer 상태와 실제 BrowserView가 불일치합니다. open operation token과 active 상태를 확인하고, close 시 진행 중인 open 결과를 무효화해야 합니다.

## 5. Minor 이슈

- [main-browser.js:213] `withTimeout()`은 race가 정상 완료되어도 내부 `setTimeout()`을 해제하지 않습니다. 각 page load/CDP 호출이 최대 15초 동안 timer를 남기므로, 반복 조작 시 불필요한 timer가 축적됩니다. timer handle을 `finally`에서 해제하는 timeout helper로 교체해야 합니다.

- [main-browser.js:246] debugger가 attach된 상태에서 BrowserView를 닫지만 명시적으로 `webContents.debugger.detach()`하지 않습니다. 종료 경로에서 attach 상태를 정리해 debugger 관련 예외와 리소스 잔존을 피해야 합니다.

- [scripts/test-electron-browser.js:70] URL 검증 테스트가 `javascript:`만 확인합니다. server redirect를 통한 `file:`, malicious title/console text의 control character, `.carrotcap/browser` symlink는 검증하지 않아 Critical 경로를 회귀 방지하지 못합니다.

## 6. Optional 제안

- [main-browser.js:179] network error URL에는 query string의 token·credential이 포함될 수 있으며 이후 agent terminal에 전송됩니다. URL의 credential/query를 redact하거나 사용자에게 전송 전 표시·확인하는 정책을 두는 것이 좋습니다.

- [renderer-browser.js:154] `{ open: false }` 상태 이벤트를 즉시 반환해 renderer의 `st.open`을 동기화하지 않습니다. 예기치 않은 view 종료에도 주소창·주석 UI가 stale 상태가 되지 않도록 close state를 처리하는 것을 권장합니다.

## 7. 최종 권고

- `will-redirect` 포함 모든 navigation 경로에서 `http(s)` allowlist를 강제한다.
- screenshot 디렉터리와 `.gitignore`의 실제 경로를 symlink-safe하게 검증하고, prune 대상이 workspace 밖으로 나갈 수 없게 한다.
- title, console message/source, annotation text를 PTY 전달 전 control character·개행 기준으로 정규화한다.
- session listener 및 BrowserView/debugger를 toggle-off와 window-close 모두에서 해제한다.
- decorate/context의 consume을 PTY 전달 성공 뒤로 미루고 open/navigation race를 token으로 무효화한다.
- 다음 테스트를 추가한다: HTTP 302→`file:` 차단, malicious console/title control-character가 shell command로 실행되지 않음, screenshot symlink 외부 삭제 방지, 반복 open/close listener 수, navigation 중 annotation 유지, context 수집 중 PTY 종료 시 context 보존.