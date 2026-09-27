# Review Report — task-025 System One (r2)

## 1. 리뷰 대상

- 파일/모듈 목록: `main-skills.js`, `main.js`, `preload.js`, `renderer.js`, `renderer-skills.js`, `index.html`, `package.json`, `settings.json`, `scripts/system-one.js`, `scripts/test-system-one.js`, `scripts/setup-clm.sh`, 관련 test 및 문서
- 변경 라인 수: 추적 파일 기준 `+555 / -50`, 신규 대상 파일 4개
- 리뷰 시점: 2026-09-27T17:23:09Z

## 2. 전체 판단

- ❌ 반려
- r1의 오류 본문 출력, 키 파일 UI, readiness 종료 문제는 수정됐지만, 정상 API 응답을 통해 API key/state가 stdout·usage log로 재노출될 수 있습니다.

## 3. Critical 이슈

- [scripts/system-one.js:187-193] 성공 응답의 `data.answers`와 `data.usage`를 검증·정제 없이 stdout JSON으로 반환합니다. CLM/Jev 서버가 bearer key 또는 요청 `state`를 `answers`/`usage`에 반사하면 CLI 출력으로 비밀값이 노출됩니다. `usage.input_tokens`만 로그에서 제한해도 반환 JSON의 `usage`는 그대로입니다. → 입력 question type별 허용 응답 schema와 숫자 범위를 검증하고, stdout/log에는 허용된 answer 필드 및 수치 usage 필드만 복사하십시오. key/state를 `answers`와 `usage`에 넣는 fake-server regression test를 추가하십시오.

- [scripts/system-one.js:134, 187-193] `safeModel()`은 `jv_test_key` 같은 공백 없는 API key를 유효한 model ID로 통과시킵니다. 따라서 서버가 key를 `model`로 반사하면 stdout과 `usage.jsonl`에 기록됩니다. 현재 test는 공백이 있는 반사값만 검증합니다. → 서버 제공 model은 신뢰하지 말고 Jev는 요청한 pinned model만 기록하거나, key와 독립적인 엄격한 model allowlist를 적용하십시오. 공백 없는 key 반사 회귀 test를 추가하십시오.

## 4. Major 이슈

- [package.json:44-63, CLAUDE.md:148, scripts/system-one.js:195] 배포 파일 목록에 `scripts/setup-clm.sh`가 없습니다. 설치형 앱의 문서와 오류 안내는 이 경로 실행을 지시하지만, 패키지에는 해당 파일이 없어 CLM 서버 setup 절차를 수행할 수 없습니다. → `build.files`에 `scripts/setup-clm.sh`를 포함하거나, 별도 배포 위치와 문서의 실행 경로를 일치시키고 packaged-build 검증을 추가하십시오.

## 5. Minor 이슈

- [scripts/test-system-one.js:147-163] 정상 응답에서 server-controlled `model`과 `usage`를 반환하는 경로는 테스트하지만, 값이 API key/state를 반사하는 경우 stdout 결과까지 검사하지 않습니다. → Critical 수정과 함께 `JSON.stringify(result)` 및 `usage.jsonl` 모두에 compact key/state가 없음을 검증하십시오.

- [scripts/test-electron-skills.js:387-400, package.json:44-63] E2E는 dev tree 기준 `scripts/system-one.js` 동작만 확인하며 packaged artifact에 `setup-clm.sh`가 실제 포함되는지는 확인하지 않습니다. → `CC_APP_EXE` packaged 실행 경로에서 resource 존재 여부와 문서가 지시한 script 경로를 검증하십시오.

## 6. Optional 제안

- [main.js:1899-1907] `system-one:clm-status`는 `/v1/models`의 모든 HTTP status를 `up: true`로 처리합니다. 의도적으로 “연결 가능”만 확인하는 정책이라면 적절하지만, 404/500인 비-CLM 서버도 UI에서 CLM 사용 가능으로 표시됩니다. → 의도를 유지한다면 UI 문구를 “연결됨”으로 명확히 하거나, CLM 식별이 필요하면 예상 응답 schema를 확인하십시오.

## 7. 최종 권고

- [ ] `answers`, `usage`, `model`의 server-controlled 값을 stdout 및 usage log에 쓰기 전에 엄격히 정제한다.
- [ ] compact API key와 request state가 정상 응답에 반사되는 regression test를 추가한다.
- [ ] `setup-clm.sh`의 packaged 배포 경로를 구현·문서화하고 packaged artifact test를 추가한다.
- [ ] 수정 후 `npm test`, `npm run test:skills`, packaged E2E를 재실행한다. 현재 리뷰 환경에서는 Temp directory 생성 권한이 없어 신규 unit test는 fixture 생성 단계에서 완료되지 않았다.