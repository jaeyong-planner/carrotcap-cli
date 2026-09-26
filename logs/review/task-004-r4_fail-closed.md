# Review Report — task-004-r4 main.js final pass

## 1. 리뷰 대상
- 파일/모듈 목록: `main.js`
- 변경 라인 수: diff metadata 없음; `main.js` 1023 lines 중 `assertAncestorsClean`, `writeIfMissing`, `safeMkdir`, `ensureAiopsProjectStructure`, `aiops:setup` write/mkdir 경로 검토
- 리뷰 시점: 2026-05-06T03:06:17Z

## 2. 전체 판단
- ✅ 승인
- r3에서 지적된 fail-open 및 `CLAUDE.md` write guard 누락은 해결됐고, r4에서 새 Critical/Major 이슈는 확인되지 않았다.
- r3 Critical 1 (`writeIfMissing` fail-open): RESOLVED — [main.js:351], [main.js:353], [main.js:358], [main.js:365], [main.js:370], [main.js:374]가 `realRoot` 도달 외 모든 종료 경로를 throw 처리하고, [main.js:361]만 정상 return 경로다.
- r3 Critical 2 (`CLAUDE.md` bypass): RESOLVED — 기존 파일 append branch는 [main.js:631]에서, 신규 파일 create branch는 [main.js:637]에서 `assertAncestorsClean(claudePath, realRoot)` 호출 후 [main.js:634], [main.js:638] write를 수행한다.
- r3 Major (`assertAncestorsClean` fail-open): RESOLVED — safety counter exhaustion, filesystem root 도달, unexpected loop termination 모두 [main.js:358], [main.js:370], [main.js:374]에서 throw 한다.
- task-002 Critical #4 (`folder:tree`): RESOLVED — [main.js:903] allowlist 검사 후 [main.js:904]에서만 tree를 생성한다.
- task-002 Critical #5 (`folder:search`): RESOLVED — [main.js:907], [main.js:908]에서 allowlist 및 query 타입 검증을 수행한다.
- task-002 Critical #6 (`folder:open-in-os`): RESOLVED — [main.js:912], [main.js:914]에서 allowlist 및 존재 검사를 수행한다.
- task-002 Critical #9 (`aiops:setup`): RESOLVED — [main.js:938], [main.js:942], [main.js:946] 경로에서 allowlist, realpath, guarded setup을 거친다.

## 3. Critical 이슈
- 없음

## 4. Major 이슈
- 없음

## 5. Minor 이슈
- 없음

## 6. Optional 제안
- [main.js:403] `safeMkdir()`는 `assertAncestorsClean()`을 직접 호출하지 않고 자체 ancestor symlink 검사와 [main.js:428] post-realpath 검증을 사용한다. 현재 r4 범위에서는 `aiops:setup`의 mkdir 경로로 충분하지만, 향후 보안 helper 중복을 줄이려면 `safeMkdir()`와 `assertAncestorsClean()`의 ancestor 검증 정책을 하나의 helper로 통합하는 회귀 방지 테스트를 추가할 수 있다.
- [main.js:348] residual TOCTOU window는 주석으로 명시되어 있고, worst-case가 “workspace 내부 write 권한을 가진 공격자가 directory swap race를 수행”하는 상황이므로 workspace 자체가 hostile한 경우에 해당한다. 본 task의 path-string 기반 write 제한으로는 허용 가능한 residual risk로 판단한다.

## 7. 최종 권고
- 다음 행동 체크리스트: task-004-r4는 승인 가능하다.
- 다음 행동 체크리스트: `assertAncestorsClean()`의 정상 종료가 [main.js:361] 하나뿐이라는 invariant를 유지한다.
- 테스트 추가 필요 지점: `assertAncestorsClean()`가 missing projectRoot, unresolvable projectRoot, symlink ancestor, safety counter exhaustion, filesystem root 도달에서 throw 하는 단위 테스트.
- 테스트 추가 필요 지점: `CLAUDE.md` existing append branch와 new create branch 모두 `assertAncestorsClean()` 실패 시 `fs.writeFileSync()`까지 가지 않는지 검증.
- 테스트 추가 필요 지점: `safeMkdir()` 이후 `agents`, `logs`, `backlog` 하위 directory swap race 시 post-realpath 검증이 setup 실패로 이어지는지 회귀 테스트.