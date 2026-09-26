# Review Report — task-007 (HEAD `783d4be`)

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `index.html`, `renderer.js`, `scripts/test-validate-settings.js`, `backlog/task-007.md`
- 변경 라인 수: 224 additions, 32 deletions
- 리뷰 시점: 2026-09-26T03:33:53Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- IPC 입력 검증·sandbox·CSP·sender 검증은 요구사항대로 적용됐으나, packaged 앱에서 CLAUDE.md 저장 경로가 `app.asar` 내부여서 저장 기능이 실패한다.

| 백로그 항목 | 상태 | 근거 |
|---|---|---|
| Critical #1 sandbox / webview | RESOLVED | [main.js:936] `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTags: false`를 함께 유지한다. |
| Critical #7 `pty:spawn` payload | RESOLVED | [main.js:263] allowlist 내부의 실제 디렉터리만 허용하고, [main.js:273] mode·cliKey·크기를 whitelist 처리한다. |
| Critical #8 `pty:write` | RESOLVED | [main.js:974] PTY id를 선검증하고 [main.js:1047] string 및 1MB 제한 뒤에만 write한다. |
| Major M3/M4 `pty:resize` / `pty:kill` | RESOLVED | [main.js:1056] resize에 id·범위 검증을 적용하고 [main.js:1061] kill에도 id 검증 wrapper를 적용한다. |
| `aor:set-claude-md` 입력 검증 | PARTIAL | [main.js:988] content 검증 및 실패 반환은 적용됐지만 [main.js:29] packaged 앱의 쓰기 불가 위치를 대상으로 한다. |
| `defaultProjectPath` fallback | RESOLVED | [main.js:733] `opts.cwd`와 `settings.defaultProjectPath` 모두 `resolveAllowedDir`을 통과해야 한다. AIOps setup은 [main.js:737] 허용 root가 있을 때만 실행된다. |
| 모든 IPC sender 검증 | RESOLVED | [main.js:966] Electron 27의 `senderFrame === webContents.mainFrame` 비교를 사용하며, 모든 등록이 [main.js:971] / [main.js:974] wrapper를 통과한다. 정상 top-level renderer 호출은 거부되지 않는다. |
| navigation / 새 창 차단 | RESOLVED | [main.js:948] http(s)만 외부 브라우저로 전달하고 새 창은 deny하며, [main.js:952] in-app navigation을 차단한다. |
| CSP | RESOLVED | [index.html:6] `script-src 'self'`, `connect-src 'none'`을 적용했다. xterm runtime style 및 renderer의 style 사용은 `style-src 'unsafe-inline'`으로 동작하며, [renderer.js:162]의 동적 HTML은 escape 처리된다. |

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [main.js:29] `CLAUDE_MD_PATH`가 `APP_ROOT/CLAUDE.md`를 가리킨다. packaged Electron에서는 `APP_ROOT`가 일반적으로 읽기 전용 `app.asar` 내부이므로 [main.js:991]의 `writeFileSync`가 항상 실패하고, [renderer.js:663]의 저장 흐름은 성공할 수 없다 → mutable CLAUDE.md를 `app.getPath('userData')` 등 쓰기 가능한 사용자 데이터 경로로 이전하고, 최초 실행 시 bundled 기본 파일을 복사해야 한다.

## 5. Minor 이슈

- [main.js:1059] `pty:resize`의 native PTY 예외를 빈 `catch`로 폐기한다. resize 실패 시 화면의 terminal 크기와 PTY 크기가 달라져도 진단할 수 없다 → 검증된 id·cols·rows를 포함한 warn 로그를 남겨야 한다.
- [main.js:1063] `proc.kill()`이 예외를 던져도 즉시 `sessions.delete(id)`를 수행한다. 실제 PTY가 살아 있으면 이후 종료·입력 제어가 불가능한 orphan session이 된다 → kill 성공 뒤에만 삭제하거나 실패 상태를 유지해야 한다.
- [renderer.js:665] 저장 실패 원인이 I/O 오류여도 “512KB 이하”라는 제한 오류만 표시한다 → main이 반환한 실패 사유를 구분하거나 범용 저장 실패 메시지를 사용해야 한다.
- [scripts/test-validate-settings.js:319] 신규 테스트는 helper 단위 검증만 수행한다. sandboxed preload, `isTrustedSender`, 실제 IPC handler, packaged CLAUDE.md 저장 경로는 검증하지 않는다 → Electron integration/CDP 테스트를 추가해야 한다.

## 6. Optional 제안

- 없음.

## 7. 최종 권고

- [ ] [main.js:29]의 CLAUDE.md 저장 위치를 사용자 데이터 디렉터리로 변경하고 기존 bundled 파일의 최초 실행 복사·migration을 구현한다.
- [ ] [main.js:1059] resize 실패를 관측 가능하게 하고, [main.js:1063]에서 kill 실패 시 session을 삭제하지 않도록 수정한다.
- [ ] packaged build에서 CLAUDE.md 편집·저장·재시작 후 재로드를 검증한다.
- [ ] sandbox 환경에서 preload bridge 존재, renderer Node API 미노출, `isTrustedSender`의 top frame 허용 및 subframe 거부를 CDP/Electron integration test로 검증한다.
- [ ] hostile IPC payload, 외부 `window.open`, xterm 렌더링과 PTY write/resize/kill lifecycle을 포함한 백로그 CDP smoke를 실행한다.