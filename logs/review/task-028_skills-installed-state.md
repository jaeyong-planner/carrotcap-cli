# Review Report — task-028 / task-029

## 1. 리뷰 대상

- 파일/모듈 목록: `main-skills.js`, `renderer-skills.js`, `scripts/test-skills.js`, `scripts/set-exe-icon.js`, `package.json`, `package-lock.json`, `build/icon.ico`, `build/icon.png` 및 관련 backlog/CHANGELOG
- 변경 라인 수: 207 additions, 18 deletions (아이콘 바이너리 2개 포함)
- 리뷰 시점: 2026-09-28T14:34:24Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- Windows의 정상 설치 레코드 처리와 command injection 방지는 적절하나, 실제 설치 검증 및 macOS/Linux 경로 비교에 Major 문제가 있습니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [main-skills.js:506-513], [renderer-skills.js:44-50], [renderer.js:1341-1351] `installed_plugins.json`에 해당 플러그인 레코드가 있다는 사실만으로 설치 완료로 판단하며 `installPath` 또는 실제 플러그인 파일을 검증하지 않습니다. 실패 시나리오: 사용자가 수동 삭제했거나 stale record가 남은 `typesafe@typesafe-ai`의 `scope: "user"` 레코드가 있으면 Jev 상태가 설치됨으로 반환되어 `claude /typesafe:typesafe-ai`를 시작합니다. third-party 항목도 설치됨으로 잠겨 inspection·consent·재설치가 모두 불가능해져, “실제 설치 상태”와 UI가 불일치합니다. → 레코드는 후보로만 사용하고, Claude CLI의 설치 상태 조회 또는 안전하게 검증한 설치 경로·플러그인 metadata 확인을 거친 경우에만 `installedElsewhere` 및 Jev 설치 상태로 인정하십시오.

- [main-skills.js:510] 실경로를 모든 OS에서 `toLowerCase()`로 비교합니다. 실패 시나리오: `dist:mac`으로 배포된 앱이 case-sensitive APFS/Linux 파일시스템에서 `/work/Project`에 설치된 project-scope plugin 레코드를 `/work/project`에서도 동일 프로젝트로 오인합니다. 다른 프로젝트의 third-party plugin이 설치됨으로 잠기거나, 없는 Jev skill이 시작될 수 있습니다. → `process.platform === 'win32'`일 때만 case-folding하고, 그 외에는 canonical realpath의 정확한 문자열 비교를 사용하십시오.

## 5. Minor 이슈

- [renderer-skills.js:241-243] preset 클릭이 `data-installed`로 잠긴 checkbox까지 `checked = false`로 변경합니다. 실패 시나리오: 이미 설치된 `typesafe`가 잠긴 상태에서 “웹 개발” preset을 누르면 typesafe는 체크 해제된 채 비활성·“설치됨”으로 남고, 완료 결과에는 다시 설치됨으로 반환됩니다. 잠긴 항목은 “체크된 채 잠금”이라는 UI 계약을 위반합니다. → preset 적용 시 `data-installed` 항목은 건너뛰거나 항상 `checked = true`를 유지하십시오.

- [scripts/test-skills.js:383-395] 새 단위 테스트는 레코드 키, Windows 대소문자, 다른 projectPath만 검증하며, stale `installPath`, `skills:status`의 `installedElsewhere`, 잠긴 UI 행, `{ action: 'installed' }`의 START/Jev/manual 호출자 처리를 검증하지 않습니다. 실패 시나리오: 위의 잘못된 설치 판정 또는 잠긴 UI 회귀가 단위 테스트 100개를 모두 통과한 채 배포됩니다. → fake Claude record 및 Electron E2E fixture로 stale record 거부, 모든 설치됨 상태의 START/Jev/manual 결과, preset 후 잠긴 checkbox 상태를 추가 검증하십시오.

## 6. Optional 제안

- [scripts/set-exe-icon.js:21-30] `fs.readdirSync()` 순서대로 첫 `rcedit-*.exe`를 선택하므로 캐시에 여러 winCodeSign 버전이 있으면 선택 결과가 비결정적입니다. → 후보를 regular file로 제한하고, 선택한 캐시 경로를 명시적으로 로그에 남기며 안정적인 우선순위를 적용하십시오. `execFileSync()`를 사용하므로 현재 경로 기반 command injection은 확인되지 않았습니다.

## 7. 최종 권고

- `installedScope()`를 실제 설치 검증 기반으로 변경하고 Jev 시작 전에도 동일 검증을 적용합니다.
- 경로 대소문자 비교를 Windows 전용으로 제한합니다.
- preset이 설치 완료 checkbox를 변경하지 않도록 수정합니다.
- stale 설치 레코드, case-sensitive 경로, `installedElsewhere` UI 잠금, START/Jev/manual 완료 결과를 E2E에 추가합니다.
- `dist:win`에서 cache 후보 다중 존재, rcedit 부재(exit 0), rcedit 실행 실패 시 동작을 자동 검증합니다.