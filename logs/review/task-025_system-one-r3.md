# Review Report — task-025 System One (r3)

## 1. 리뷰 대상

- 파일/모듈 목록: `main-skills.js`, `main.js`, `preload.js`, `renderer.js`, `renderer-skills.js`, `scripts/system-one.js`, 신규 test/script, `CLAUDE.md`, `templates/aiops/CLAUDE-block.md`
- 변경 라인 수: 추적 파일 기준 `+559 / -50`, 신규 검토 파일 3개
- 리뷰 시점: 2026-09-27T17:27:49Z

## 2. 전체 판단

- ❌ 반려
- r2의 응답 정제·배포 파일·2xx 상태 판정은 반영됐지만, 짧은 CLM API key가 서버 `model` 반사 시 stdout과 usage log에 노출됩니다.

## 3. Critical 이슈

- [scripts/system-one.js:167-169, 237-245] `reportedModel()`은 서버의 `clm-1` 같은 형식의 model을 신뢰하고, 최종 key guard는 길이 8자 이상만 검사합니다. 예를 들어 `CLM_API_KEY=clm-1`인 서버가 `{"model":"clm-1"}`을 반환하면 결과 JSON과 `usage.jsonl`에 key가 그대로 기록됩니다. → 서버 제공 model을 출력하지 말고 Jev는 요청한 pinned model, CLM은 고정 `"clm"` 또는 별도 신뢰 가능한 local identifier만 기록하십시오. 모든 non-empty key를 대상으로 한 회귀 테스트를 추가하고 stdout 및 usage log 모두에 key가 없음을 검증하십시오.

## 4. Major 이슈

- [scripts/system-one.js:58-75, 206-208; CLAUDE.md:180] 문서는 “질문 id(키)는 모델에 전달되지 않는다”고 명시하지만, `payload.questions = body.questions`는 사용자 제공 id를 그대로 API에 보냅니다. id에는 형식·길이 제한도 없어 지시문성 문자열이 모델 입력에 포함될 수 있습니다. → 전송 전 id를 `q0`, `q1` 같은 opaque id로 매핑하고 응답 정제 뒤 원래 id로 역매핑하십시오. 최소한 id allowlist/길이 제한을 추가하고 문서를 실제 동작과 일치시키십시오.

- [scripts/system-one.js:74, 198, 207; CLAUDE.md:191] Jev 버전 고정 규칙과 달리 request `model`은 `jev-latest`를 허용하고, `JEV_MODEL`은 검증 없이 payload에 전달됩니다. 또한 서버가 다른 semver model을 반환하면 그 값을 기록합니다. 이는 모델 변경 시 임계값을 재검증해야 한다는 운영 규칙을 우회합니다. → `JEV_MODEL`과 request model을 명시적 semver allowlist로 제한하거나 default `jev-1.13.0`만 사용하고, 결과 model은 요청한 pinned model으로 기록하십시오. `jev-latest`, 비정상 env 값, 서버의 다른 model 반사 회귀 테스트를 추가하십시오.

## 5. Minor 이슈

- [scripts/test-electron-skills.js:387-401] `system-one:clm-status`의 2xx 전용 판정은 구현됐지만 E2E는 200만 검사합니다. 401/404/500 응답이 `up: false`인지 고정하지 않아 r2 수정이 회귀할 수 있습니다. → fake CLM 서버의 non-2xx 응답 케이스를 추가하십시오.

- [scripts/test-validate-settings.js:442-503; package.json:44-64] SETUP이 `setup-clm.sh`를 프로젝트에 복사하고 build files에 포함하는 구현은 적절하지만, 테스트는 source tree 기준입니다. packaged asar에서 실제 파일을 읽어 프로젝트로 복사하는 경로는 검증하지 않습니다. → packaged executable 대상으로 SETUP 후 `<project>/scripts/setup-clm.sh` 존재 및 내용 확인을 추가하십시오.

- [CLAUDE.md:148] `SYSTEM_ONE_BACKEND=clm|jev`만 단일 백엔드 선택값으로 문서화했지만 구현은 기본값 및 유효값으로 `auto`도 지원합니다. → `auto|clm|jev`로 문구를 수정하십시오.

## 6. Optional 제안

- 없음.

## 7. 최종 권고

- [ ] server-controlled model 값을 key 노출 경로에서 제거하고 짧은 key 반사 회귀 테스트를 추가한다.
- [ ] question id를 opaque id로 전송·역매핑하거나 문서와 입력 검증 정책을 정정한다.
- [ ] Jev model pinning을 코드·환경변수·출력 기록에 일관되게 적용한다.
- [ ] CLM status non-2xx 및 packaged SETUP 복사 E2E를 추가한다.
- [ ] 수정 후 `npm test` 및 `npm run test:skills`를 재실행한다.