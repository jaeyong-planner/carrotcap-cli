# Review Report — task-004-r3 main.js ancestor-guard

## 1. 리뷰 대상
- 파일/모듈 목록: `main.js`
- 변경 라인 수: diff 미제공, `main.js` 내 `assertAncestorsClean`, `writeIfMissing`, `safeMkdir`, `ensureAiopsProjectStructure`, `aiops:setup` 경로 기준 검토
- 리뷰 시점: 2026-05-06T03:03:05Z

## 2. 전체 판단
- ❌ 반려
- r2 반영은 대부분 닫혔지만, `writeIfMissing()`와 `CLAUDE.md` 직접 쓰기 경로에 write-before-final-proof 문제가 남아 있다.
- r2 NEW Critical: PARTIAL — [main.js:384]에서 `assertAncestorsClean()`를 호출하지만 [main.js:386] `fs.writeFileSync()` 사이에 외부 프로세스가 parent directory를 symlink/junction으로 교체하면 workspace 밖 write가 먼저 발생하고 [main.js:388] 이후 post-write 검사로만 감지된다.
- r2 NEW Major: RESOLVED — [main.js:646]부터 반환 경로 `agentsDir`, `logsDir`, `backlogDir`, `claudePath`를 `safeRealpath()` + `isPathInsideRoot(..., realRoot)`로 재검증하고 실패 시 [main.js:651] `null`을 반환한다.
- r2 Minor: RESOLVED — [main.js:926] 주석이 `folder:pick` 필수와 `defaultProjectPath`가 permission grant가 아님을 명시한다.
- task-002 Critical #4 (`folder:tree`): RESOLVED — [main.js:903], [main.js:904] allowlist 검사를 수행하고, [main.js:996]부터 부팅 allowlist는 `workspace-state.json`만 사용한다.
- task-002 Critical #5 (`folder:search`): RESOLVED — [main.js:907], [main.js:908] allowlist와 query 타입/길이 제한을 적용하고, settings 기반 allowlist 오염 경로는 제거됐다.
- task-002 Critical #6 (`folder:open-in-os`): RESOLVED — [main.js:912], [main.js:913], [main.js:915] allowlist와 존재 검사를 수행한다.
- task-002 Critical #9 (`aiops:setup`): PARTIAL — [main.js:924], [main.js:929], [main.js:937] allowlist와 realpath 기반 setup은 추가됐지만 [main.js:386], [main.js:627], [main.js:630] write 경로에 race성 workspace 밖 write 가능성이 남는다.

## 3. Critical 이슈
- [main.js:384] `assertAncestorsClean()` 검사가 [main.js:386] `fs.writeFileSync()`와 atomic하게 묶이지 않아, 검사 직후 parent directory가 symlink/junction으로 교체되면 workspace 밖 파일이 먼저 생성될 수 있다 → post-write [main.js:388] 검사는 보조 방어로만 두고, 쓰기 전에 `targetPath`의 parent가 검증된 `realRoot` 내부의 실제 directory임을 fail-closed로 보장하는 방식으로 바꾸거나, Node path 기반 write로는 완전 차단이 불가능하다는 residual risk를 명시하고 이 경로를 보안 경계로 사용하지 않아야 한다.
- [main.js:627] 기존 `CLAUDE.md` append write와 [main.js:630] 신규 `CLAUDE.md` write가 `writeIfMissing()`/`assertAncestorsClean()`를 우회한다 → `CLAUDE.md` 쓰기 직전에도 `assertAncestorsClean(claudePath, realRoot)` 수준의 before-write ancestor 검사를 수행하고, 현재처럼 [main.js:633] post-write 검사만으로 workspace escape를 처리하지 않아야 한다.

## 4. Major 이슈
- [main.js:356] `assertAncestorsClean()`가 safety counter exhaustion 또는 [main.js:366] filesystem root 도달로 loop가 끝나도 throw하지 않고 [main.js:369]에서 정상 반환한다 → `realRoot`에 도달하지 못한 모든 종료 경로는 “검증 실패”로 throw해야 하며, safety counter 64 소진도 post-write 검사에 맡기지 말고 before-write 단계에서 실패시켜야 한다.

## 5. Minor 이슈
- 없음

## 6. Optional 제안
- [main.js:646] final verification loop의 `if (!fs.existsSync(p)) continue`는 동기 IPC 흐름상 삭제로 보안 검사를 우회해 workspace 밖 경로를 승인하는 문제는 아니다. 다만 외부 프로세스가 검증 직전에 directory를 삭제하면 반환 객체에 존재하지 않는 `agentsDir`/`logsDir`/`backlogDir`가 포함될 수 있으므로, `claudePath`만 optional로 두고 directory 3개는 missing이면 `null` 반환하는 테스트를 추가하는 편이 명확하다.

## 7. 최종 권고
- 다음 행동 체크리스트: `assertAncestorsClean()`가 `realRoot`에 도달하지 못하면 반드시 throw하도록 fail-closed 처리한다.
- 다음 행동 체크리스트: `CLAUDE.md` 직접 write block [main.js:616]~[main.js:641]에도 before-write ancestor 검사를 추가한다.
- 다음 행동 체크리스트: `writeIfMissing()`의 remaining TOCTOU를 보안 요구사항상 허용할지 결정하고, 허용하지 않는다면 path 문자열 기반 `writeFileSync` 설계를 재검토한다.
- 테스트 추가 필요 지점: `assertAncestorsClean()`가 drive root 도달, `realRoot` 미도달, safety counter exhaustion에서 throw하는지 단위 테스트.
- 테스트 추가 필요 지점: `CLAUDE.md`가 없는 상태에서 project root가 symlink/junction으로 교체된 경우 write 전에 실패하는지 검증.
- 테스트 추가 필요 지점: `safeMkdir(agentsDir)` 이후 `agents`를 workspace 밖 symlink/junction으로 교체한 상태에서 `writeIfMissing(path.join(agentsDir, 'supervisor.md'))`가 workspace 밖 파일을 생성하지 않는지 검증.