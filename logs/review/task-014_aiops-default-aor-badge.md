# Review Report — feature/v0.2.0 AIOps 기본 ON / AOR 배지 변경

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `preload.js`, `renderer.js`, `settings.json`, `README.md`, 테스트 스크립트
- 변경 라인 수: 10개 파일, 109 additions / 37 deletions (`b9ecbb1..HEAD`)
- 리뷰 시점: 2026-09-26T14:31:57Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- 한 줄 요약: IPC 신뢰 경계와 workspace allowlist는 유지되지만, v3 migration이 기존 사용자의 AIOps OFF 선택을 ON으로 덮어쓴다.

## 3. Critical 이슈

- 없음

## 4. Major 이슈

- [main.js:174-176] `settingsVersion < 3`이면 기존 `aor.autoStart: false`를 무조건 `true`로 변경한다. v0.2 설정 화면에서 사용자가 AIOps를 끈 경우에도 그 상태와 “기본값 false라 선택하지 않았음”을 구분할 근거가 없으므로, 실제 사용자 선택을 덮어쓴다. 이후 `settingsVersion: 3`으로 저장되어 복구도 어렵다 → 기존 값이 boolean이면 보존하고, 값이 누락된 설정에만 기본 ON을 적용하거나 명시적 migration marker를 도입해야 한다.
- [main.js:780-784] `copyTemplateIfMissing()`의 쓰기 실패가 `ensureAiopsProjectStructure()`에서 처리되지 않는다. 기존 `agents/`, `backlog/` 디렉터리는 접근 가능하지만 새 템플릿 파일 생성이 거부되는 workspace에서 예외가 `aiops:setup` 및 `pty:spawn`까지 전파된다. AIOps가 기본 ON이므로 사용자가 선택한 보호된 프로젝트에서 첫 pane 생성이 실패할 수 있다 → 각 템플릿 복사를 `try/catch`로 감싸 실패를 `{ ok: false, error }` 또는 `null`로 일관되게 반환하고 renderer가 오류를 표시해야 한다.

## 5. Minor 이슈

- [settings.json:12] `_comment`는 엔진 미발견 시 `AOR-FALLBACK(PLAIN)` 헤더가 표시된다고 안내하지만, 현재 구현은 [main.js:884-892], [renderer.js:465-470]에서 `plain`/`aiops` 라벨과 tooltip note를 사용한다 → 실제 fallback 및 tooltip 동작에 맞게 문구를 수정해야 한다.

## 6. Optional 제안

- [main.js:616-643, main.js:1431] `aor:status` 호출마다 최대 36개 후보에 동기 `fs.existsSync`를 수행한다. 현재 renderer는 boot 시 1회만 호출하고 반환값도 boolean뿐이며 trusted-sender wrapper [main.js:1112-1119]를 통과하므로 정보 노출 문제는 확인되지 않았다. 다만 UNC·느린 네트워크 경로를 후보에 둔 사용자는 반복 호출 시 main process가 지연될 수 있다 → status 결과를 짧게 cache하고 `settings:set` 시 invalidate하는 방안을 검토할 수 있다.
- [renderer.js:427-451, main.js:879] 첫 AIOps pane은 renderer의 `aiops:setup` 후 `pty:spawn` 내부에서 다시 `ensureAiopsProjectStructure()`를 호출한다. 현재는 idempotent라 외부 workspace write는 allowlist 내부로 제한되지만 불필요한 파일 검사·읽기가 중복된다 → spawn 결과에 setup 완료 상태를 전달하거나 main process 한 곳에서만 setup을 수행하도록 책임을 단일화할 수 있다.

## 7. 최종 권고

- `aor.autoStart: false`가 있는 v1/v2 설정을 보존하도록 v3 migration을 수정한다.
- template copy 실패가 IPC rejection이나 빈 pane으로 이어지지 않도록 예외 처리를 보강한다.
- [scripts/test-validate-settings.js:605-621]에 “v2에서 사용자가 명시적으로 OFF한 값이 migration 후에도 false”인 회귀 테스트를 추가한다.
- [main.js:780-784]에 기존 디렉터리 내 파일 생성 권한 거부 시 `aiops:setup`과 `pty:spawn`이 제어된 오류를 반환하는 테스트를 추가한다.
- [scripts/test-electron-smoke.js:294-297]에 엔진 있음/없음 각각에서 배지 표시 상태와 AIOps 기본 ON을 검증하는 fixture 또는 mock 기반 테스트를 추가한다.