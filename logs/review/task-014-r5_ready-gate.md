# Review Report — feature/v0.2.0 `HEAD ad1bede`

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `scripts/test-validate-settings.js`
- 변경 라인 수: `main.js` 22 additions / 4 deletions, `scripts/test-validate-settings.js` 3 additions
- 리뷰 시점: 2026-09-26T15:02:18Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- 한 줄 요약: fallback kill 실패 처리는 해결됐으나, template 복사 함수의 실패 반환값을 무시해 AIOps 구조가 불완전해도 성공으로 보고할 수 있습니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [main.js:264-278] [main.js:787-795] 이전 Major — **PARTIAL**. `copyTemplateIfMissing()`은 템플릿이 사라졌거나 읽기 실패 시 `false`를 반환하지만, 호출부는 반환값을 검사하지 않습니다. 사전 `findMissingAiopsTemplates()` 검사 이후 발생한 파일 변경·읽기 권한 오류에서는 일부 파일만 배포된 채 `ensureAiopsProjectStructure()`가 성공을 반환하고 caller도 성공 처리합니다. `false`를 오류로 승격해 `null`을 반환하거나, 복사 결과를 명시적으로 검사해야 합니다.
- [main.js:1026-1030] [main.js:1299-1305] 이전 Major — **RESOLVED**. fallback `child.kill()`의 `false` 반환은 예외로 전환되고, kill 실패 시 session·ready gate가 유지됩니다.
- [main.js:1046-1062] [main.js:1276-1283] 이전 Major — **RESOLVED**. pre-ready 입력은 단일 문자열로 유지되며 1MB UTF-8 cap 및 32개 session cap이 적용됩니다.
- [main.js:174-180] 이전 Major — **RESOLVED**. v2의 실제 boolean `aor.autoStart`는 보존하고, v1 및 v2의 누락·비boolean 값은 `true`로 정규화합니다.

## 5. Minor 이슈

- [main.js:976-984] [main.js:1072-1080] [main.js:1169-1175] [main.js:1299-1305] 이전 Minor — **RESOLVED**. exit, window close, 성공한 kill에서 ready-gate timer와 pending buffer가 정리되며, 실패한 fallback kill은 session을 유지해 이후 exit 정리가 가능합니다.
- [settings.json:12] 이전 Minor — **RESOLVED**. 기본 `aor.autoStart: true`와 v3 migration 동작이 일치합니다.

## 6. Optional 제안

- [scripts/test-electron-smoke.js:217-224] fallback `child.kill()`이 `false`를 반환하거나 throw할 때 session과 ready gate가 유지되고, 이후 exit에서 정리되는 결정적 회귀 테스트가 없습니다 → fallback child stub으로 두 실패 경로와 silent shell의 10초 timer flush를 검증해야 합니다.
- [scripts/test-validate-settings.js:418-474] [main.js:264-278] `copyTemplateIfMissing()`의 source read 실패 또는 source 삭제 후 `false` 반환 경로가 검증되지 않습니다 → 해당 경우 `ensureAiopsProjectStructure()`가 `null`을 반환하고 `aiops:setup` 및 pane 생성 caller가 실패/warning을 전달하는 테스트를 추가해야 합니다.
- [main.js:1053-1060] pre-ready buffer의 FIFO flush는 구현상 보장되지만, 다수의 작은 write와 max-timer flush를 함께 검증하는 테스트가 없습니다 → 입력 순서와 1MB 누적 cap을 고정하는 테스트를 추가해야 합니다.

## 7. 최종 권고

- `copyTemplateIfMissing()`의 `false` 반환을 실패로 취급하여 `ensureAiopsProjectStructure()`가 `null`을 반환하도록 수정한다.
- 템플릿 read 실패·TOCTOU 삭제 시 caller가 성공을 반환하지 않는 회귀 테스트를 추가한다.
- fallback kill 실패, silent shell, pre-ready resize/kill, FIFO flush에 대한 결정적 테스트를 추가한다.
- `node --check main.js` 및 `git diff --check c5aa9b9..HEAD`는 통과했습니다. `node scripts/test-validate-settings.js`는 read-only sandbox의 Temp 디렉터리 생성 권한 부족으로 완료하지 못했습니다.