# Review Report — task-027 (Windows registered PATH)

## 1. 리뷰 대상

- `main-winpath.js`, `main.js`, `main-skills.js`, `renderer.js`, `package.json`
- `scripts/test-winpath.js`, `scripts/test-electron-smoke.js`, `scripts/test-electron-winpath.js`, `scripts/lib/cdp-app.js`, `backlog/task-027.md`
- 변경 라인 수: +501 / -17 (untracked 파일 포함)
- 리뷰 시점: 2026-09-27T23:54:58Z

## 2. 전체 판단

- ✅ 승인
- 등록 PATH는 앱 PATH 뒤에만 병합되고, PowerShell 상수 명령·비동기 캐시·IPC 경계·pane 고정 처리가 적절합니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- 없음.

## 5. Minor 이슈

- [scripts/test-electron-winpath.js:105-111] Flow 대기 회귀 검증은 `REVIEW`만 다루며, `clmStatus()` 또는 SKILLS 창을 기다리는 System One `CLM` flow 중 pane 전환 시 `stillTarget(target)`이 명령 전송을 차단하는 경로는 자동화되어 있지 않습니다. → `data-flow="clm"` fixture에서 CLM 응답 또는 Jev 설치 창을 지연시키고, 대기 중 다른 pane을 선택한 뒤 어느 pane에도 CLI 명령이 쓰이지 않으며 `PANE_CHANGED` 상태가 표시되는 E2E를 추가하십시오.

## 6. Optional 제안

- [package.json:11] `npm test`는 unit `test-winpath.js`만 실행하고 Windows 전용 pane-close/Quick CLI 회귀 E2E는 별도 `test:winpath`에 남습니다. → Windows CI가 있다면 `test:winpath`를 Windows 검증 단계에 포함해 async spawn 회귀를 기본적으로 감지하십시오.

## 7. 최종 권고

- [x] PowerShell은 절대 경로의 `execFile`과 고정 script를 사용하며, 사용자 입력이 shell command로 결합되지 않습니다.
- [x] `CARROTCAP_TEST_REGISTRY_PATH` 및 지연 hook은 `!app.isPackaged`에서만 적용됩니다.
- [x] app PATH 우선, case·trailing slash dedupe, UTF-8, `%VAR%` 확장, 실패 시 기존 PATH fallback, `Path`/`PATH` 단일화, non-Windows 무영향을 확인했습니다.
- [x] `pty:spawn`, `cli:status`, `findCommandSync`, SKILLS 검색이 동일한 PATH cache를 사용하며, pane 전환 후 잘못된 pane으로 명령을 보내지 않도록 확인했습니다.
- [ ] System One flow의 pane 전환 E2E를 추가하십시오.
- 검증: `node scripts/test-winpath.js`는 unit assertions 진행 중 sandbox의 `%TEMP%` 생성 권한(`EPERM`) 때문에 마지막 test-file fixture 이전에 중단되어, 이 환경에서 전체 완료 결과는 확인하지 못했습니다.