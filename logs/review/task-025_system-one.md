# Review Report — task-025 System One (CLM-8B 우선 · Jev 대체)

## 1. 리뷰 대상

- 파일/모듈 목록: `main-skills.js`, `main.js`, `preload.js`, `renderer.js`, `renderer-skills.js`, `index.html`, `settings.json`, `scripts/system-one.js`, `scripts/setup-clm.sh`, 관련 unit/E2E test 및 `CLAUDE.md`
- 변경 라인 수: 추적 파일 기준 `+485 / -46`, 신규 리뷰 대상 4개 파일 489줄
- 리뷰 시점: 2026-09-27T17:16:19Z

## 2. 전체 판단

- ❌ 반려
- IPC argv allowlist, marketplace 분리, CLM URL 검증은 적절하나, 서버 오류 본문을 그대로 출력해 API key가 노출될 수 있습니다.

## 3. Critical 이슈

- [scripts/system-one.js:118-123, 182-189, 206-209] API 서버가 반환한 `detail`/`error`/`message`를 stderr로 그대로 출력하고, 응답 `model`은 usage log에도 기록합니다. CLM 또는 Jev 서버가 bearer token·요청 본문을 오류 상세에 반사하면 `CLM_API_KEY`/`TYPESAFE_API_KEY`가 터미널 또는 `logs/system-one/usage.jsonl`에 노출될 수 있어 “key never logged/printed” 계약을 위반합니다. → 원격 응답 상세는 출력하지 말고 status별 고정 안내만 사용하며, 기록할 `model`은 엄격한 allowlist 형식만 허용하십시오. key와 state를 오류 본문에 넣어 반환하는 fake server regression test도 추가하십시오.

## 4. Major 이슈

- [main.js:215-240, preload.js:76-79, renderer.js:1116-1129, index.html:45-63] 백로그의 “Jev API 키 넣을 곳을 메모장으로 열기” 기능이 구현되지 않았습니다. 현재는 경로를 상태문구로 알려줄 뿐, `keys.env`를 생성하거나 사용자가 편집기로 열 IPC/UI가 없습니다. → main process에서 profile `keys.env`만 대상으로 생성·열기를 수행하는 고정 IPC를 추가하고, renderer에는 JEV/SKILLS 영역의 명시적 “키 파일 열기” 동작만 노출하십시오. key 내용은 IPC 반환값에 포함하지 마십시오.

- [scripts/setup-clm.sh:47-53] encoder readiness loop가 180회 모두 실패해도 오류 종료하지 않고 `clm-serve`를 시작합니다. 최대 15분 뒤 준비되지 않은 encoder를 가진 서버가 기동되어 CLM 요청 실패로 이어집니다. → readiness flag를 두고 loop 종료 후에도 `/v1/models`가 성공하지 않으면 명확한 오류와 exit 1로 종료하십시오.

## 5. Minor 이슈

- [renderer.js:1132-1136] JEV 실행은 활성 PTY 존재 여부를 확인하기 전에 `ensureJev()`를 실행합니다. PTY가 없는 상태에서도 third-party plugin 설치 모달까지 열 수 있으나, 설치 후 실제 실행은 하지 않습니다. → `activeLeafOrWarn()`를 먼저 호출하거나, 설치 완료 뒤 PTY 상태를 다시 확인해 불필요한 설치 흐름을 막으십시오.

- [scripts/test-system-one.js:100-103, 148-152] 현재 테스트는 API `detail`을 stderr에 보여 주는 동작을 정상으로 고정합니다. → Critical 수정 후 key·state를 포함한 응답 detail이 stderr와 usage log 어디에도 남지 않는 테스트로 교체하십시오.

- [scripts/test-validate-settings.js:565-580] `CARROTCAP_KEYS_FILE` override는 `app.isPackaged: false`인 wrapper만 검증합니다. → packaged 상태에서는 override가 무시되고 `%USERPROFILE%\.carrotcap\keys.env`만 선택되는 regression case를 추가하십시오.

- [scripts/test-system-one.js:143-159] CLM의 connection timeout/연결 후 응답 지연 경계를 검증하지 않습니다. → 연결 거부, TCP 연결 후 무응답, HTTP 5xx를 분리한 fake-server test를 추가해 Jev fallback이 “unreachable만” 발생함을 고정하십시오.

## 6. Optional 제안

- [main-skills.js:204-240, scripts/test-skills.js:339-374] `"./"` root plugin의 symlink 거부와 설치본 digest 검증은 구현되어 있습니다. 실제 marketplace fixture에 root-level 추가 파일·symlink·설치본 불일치를 넣은 E2E 케이스를 추가하면 새 source 형식의 보안 회귀를 더 직접적으로 방지할 수 있습니다.

## 7. 최종 권고

- [ ] `scripts/system-one.js`에서 원격 오류 상세 및 검증되지 않은 metadata가 key/state를 출력·기록하지 않도록 수정한다.
- [ ] `keys.env`를 안전하게 생성·편집기로 여는 사용자 흐름을 구현한다.
- [ ] encoder readiness timeout 시 `setup-clm.sh`가 실패 종료하도록 수정한다.
- [ ] 위 Major/Critical regression test를 추가한다.
- [ ] `npm test`를 sandbox 밖에서 재실행한다. 이번 환경에서는 `scripts/test-validate-settings.js`의 Temp directory 생성이 `EPERM`으로 차단되어 완료되지 않았다.