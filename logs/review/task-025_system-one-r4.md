# Review Report — task-025 System One (r4)

## 1. 리뷰 대상

- 파일/모듈 목록: `main-skills.js`, `main.js`, `preload.js`, `renderer.js`, `renderer-skills.js`, `scripts/system-one.js`, 신규 테스트·설정 스크립트, `CLAUDE.md`, `templates/aiops/CLAUDE-block.md`
- 변경 라인 수: 추적 파일 기준 `+571 / -50`, 신규 검토 파일 3개
- 리뷰 시점: 2026-09-27T17:34:12Z

## 2. 전체 판단

- ❌ 반려
- r3의 모델 반사, opaque question id 전송, pinned Jev model, CLM non-2xx 및 SETUP 검증은 반영됐지만, 유효한 API key가 usage log에 기록될 수 있습니다.

## 3. Critical 이슈

- [scripts/system-one.js:213-216, 245, 253-265] `log()`는 원본 question id를 `questions` 필드에 기록합니다. question id는 `[A-Za-z0-9_-]{1,64}`만 허용하므로 `CLM_API_KEY` 또는 `TYPESAFE_API_KEY` 값 자체가 유효한 id일 수 있습니다. 특히 성공 응답에서 final guard가 key를 발견하면 line 265에서 `refused-echo`를 기록하지만, 그 로그에는 이미 원본 id가 포함됩니다. HTTP 오류 및 malformed answer 경로도 같은 방식으로 기록합니다. → usage log에는 원본 id를 절대 쓰지 말고 opaque `q0…` 또는 question type 배열/개수만 기록하십시오. 또한 validation 및 malformed-answer stderr에서 원본 id를 보간하지 않도록 바꾸십시오. API key와 같은 id를 가진 정상 응답·HTTP 오류·malformed 응답 각각에서 stdout, stderr, `usage.jsonl` 모두에 key가 없음을 검증하는 회귀 테스트를 추가하십시오.

## 4. Major 이슈

- 없음.

## 5. Minor 이슈

- 없음.

## 6. Optional 제안

- 없음.

## 7. 최종 권고

- [ ] `scripts/system-one.js`의 usage log 및 오류 메시지에서 사용자 제공 question id를 제거하거나 opaque id로 대체한다.
- [ ] key와 동일한 question id를 사용한 success/error 회귀 테스트를 `scripts/test-system-one.js`에 추가한다.
- [ ] 수정 후 `npm test` 및 Electron SKILLS E2E를 재실행한다.