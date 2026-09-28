# Review Report — task-030 AI DEV FLOW 단계 상태 표시

## 1. 리뷰 대상

- `renderer.js` (+118 / -23)
- `styles.css` (+16)
- `scripts/test-electron-winpath.js` (+14)
- `scripts/test-electron-skills.js` (+4)
- 변경 라인 수: +152 / -23
- 리뷰 시점: 2026-09-28T14:11:36Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- 단일 실행 경로·DOM XSS 방지는 적절하나, 중첩 실행 시 이전 flow가 새 flow의 상태를 오염시키거나 CLI를 계속 실행할 수 있습니다.

## 3. Critical 이슈

- 없음

## 4. Major 이슈

- [renderer.js:133-136, 1410-1427, 1451-1484] 새 flow를 시작해도 이전 flow가 취소되지 않아, 대기 중이던 이전 flow가 이후 `api.writePty()`까지 진행할 수 있습니다. 예: shell 준비를 기다리는 REVIEW를 누른 뒤 SETUP 또는 다른 flow를 누르면, 이전 REVIEW는 화면 상태 갱신만 무시된 채 준비 완료 후 Codex CLI를 기존 pane에 실행합니다. 사용자는 SETUP 완료 화면만 보게 되어 실행 사실과 상태가 불일치합니다. `flowRun` 교체 시 이전 run을 취소하고, 각 `await` 뒤 및 `api.writePty()` 직전에 해당 run이 현재 run인지 확인해야 합니다.

- [renderer.js:115-121, 1292-1305, 1391-1403, 1439-1483] `setFlowStatus()`가 메시지의 발생 run을 구분하지 않아, 이전 flow 또는 unrelated 동작의 `warn`/`ok`가 현재 flow의 note로 추가됩니다. 예: flow A가 pane 준비를 기다리는 동안 다른 pane으로 이동해 flow B를 시작하면, flow A의 `PANE_CHANGED` 경고가 flow B의 note로 표시됩니다. 이는 “stale run이 newer run을 mark하지 않아야 함” 조건을 위반합니다. `setFlowStatus`와 경고 발생 경로에 run identity를 전달하고, `run !== flowRun`이면 note 추가도 차단해야 합니다.

## 5. Minor 이슈

- [renderer.js:115-121, 1209-1211] 실행 중 tone 없는 상태 메시지를 전부 폐기합니다. `터미널을 준비하는 중…`은 단계로 대체 가능하지만, 프로젝트 폴더 선택 후의 상태 안내도 사라집니다. flow 진행 안내만 필터링하거나, unrelated 상태는 flow와 분리된 위치에 표시해야 합니다.

## 6. Optional 제안

- [scripts/test-electron-winpath.js:113-124] 성공·중단 상태 테스트는 `.flow-step` 및 아이콘/텍스트를 확인하므로 기존 한 줄 상태 구현으로는 통과할 수 없습니다. 다만 동시 REVIEW→SETUP, REVIEW→다른 flow, stale warning의 신규 flow note 유입을 재현하는 E2E를 추가하면 위 Major 회귀를 방지할 수 있습니다.

## 7. 최종 권고

- 이전 run의 취소 또는 generation token을 도입하고, 모든 await 뒤와 `api.writePty()` 직전에 현재 run 여부를 검증한다.
- `setFlowStatus()`에 run 소유권을 부여하여 stale/unrelated 메시지가 현재 flow note로 유입되지 않게 한다.
- 동시 flow 및 SETUP 클릭 E2E에서 이전 CLI가 실행되지 않고, 새 flow의 steps/notes가 오염되지 않음을 검증한다.
- `node --check`로 변경 JavaScript 파일의 문법은 확인됨.