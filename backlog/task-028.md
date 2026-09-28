# task-028 — SKILLS 창이 실제 설치 상태를 반영 (이미 설치된 항목이 "설치 안 됨"으로 보임)

## 요청 (2026-09-28)
`superpowers`가 이미 설치돼 있는데 SKILLS에서 체크하면 "내용을 확인해야 설치할 수 있습니다 (\"구성 불러오기\" — 마켓 정보가 없으면 설치 불가)"가 계속 뜸. → "그럼 해당 부분은 설치됨으로 표시되어야지" → "이미 설치된 항목은 체크 막고 경고에서 제외" → "설치 버튼도 처리".

## 조사 (근거)
- `설치됨` 배지는 `skills:status`가 돌려주는 **앱 자신의 프로젝트별 state 파일**(`writeState`)만 봄. 그래서 user scope 설치, `claude` CLI로 한 설치, 다른 프로젝트에서 한 설치는 전부 "설치 안 됨"으로 보임
- 앱에는 이미 정답 코드가 있었음 — `jevInstalled()`가 Claude의 `installed_plugins.json`을 직접 읽음. 다만 `pluginKey('typesafe')`로 하드코딩돼 typesafe 전용이었음
- 3자 동의 경고는 설치 여부와 무관하게 체크된 항목만 보므로, 이미 설치된 항목을 체크하면 계속 "구성 불러오기"를 요구함. 확인 기록(`remoteDone`)은 창 세션 메모리라 창을 열 때마다 초기화됨
- 실측: 이 PC에서 `superpowers`(user)·`typesafe`(user)와 project scope 9개, 합계 11개 전부가 "설치 안 됨"으로 보이고 있었음
- `setBusy(busy)`가 `listEl.querySelectorAll('input').forEach((c) => { c.disabled = busy; })`로 **모든 입력을 무조건 재활성화**함 → 단순 `disabled`만으로는 잠금이 유지되지 않음
- 모두 설치된 프로젝트에서는 고를 항목이 없어 설치 버튼이 "설치할 스킬을 고르세요"로 막다른 길이 됨. 특히 **JEV 버튼은 `renderer.js`가 `action === 'installed'` + 목록에 `typesafe` 포함을 요구**하므로, typesafe를 설치해 둔 상태에서 오히려 Jev가 시작되지 않았음. AIOps `start` 흐름도 `action === 'closed'`면 중단됨

## 변경
- `main-skills.js`
  - `installedScope(id, root, { configDir, realpath })` — `jevInstalled()`를 일반화. 카탈로그 id의 설치 스코프(`user` / `project` / `local`)를 Claude의 `installed_plugins.json`에서 읽고, 없으면 `null`. `jevInstalled(root, opts)`는 `installedScope('typesafe', root, opts)` 래퍼로 남겨 기존 호출부·테스트 유지
  - `skills:status` — 결과에 `installedElsewhere`를 **별도 필드로** 추가. `installed`의 뜻을 바꾸면 `needsSetup()`의 "처음 시작하는 프로젝트" 판정이 깨지므로 건드리지 않음 (state 파일이 없을 때 `{ installedElsewhere: [] }`를 돌려줘도 `needsSetup()` 결과는 전과 동일함을 확인)
  - `installedScope`를 export (단위 테스트용)
- `renderer-skills.js`
  - 이미 설치된 행은 체크된 채 잠금. 잠금 표시는 `cb.dataset.installed`에 실음 — `setBusy()`가 모든 입력을 재활성화하므로 `disabled`만으로는 유지되지 않음. `setBusy()`도 이 속성을 보게 고침
  - `checked()`가 `:not([data-installed])`로 잠긴 행을 제외 → 재설치되지 않고, 3자 동의 줄에도 잡히지 않음(`thirdEl.hidden`으로 줄 자체가 사라짐)
  - 고를 항목이 하나도 없으면 버튼이 `시작`(start) / `Jev 시작`(jev) / `닫기`(manual)로 바뀌고, 누르면 이미 설치된 목록으로 `{ action: 'installed', installed: [...] }`를 돌려줌 → JEV·AIOps 흐름이 정상 진행. 고를 항목이 있는데 아무것도 안 고르면 버튼 비활성

## 테스트
- unit `test-skills.js` 100 (94 → +6, task-028 블록): 마켓별 레코드 키, user scope는 모든 프로젝트에서 설치로 인정, 다른 카탈로그 id는 영향 없음, 다른 폴더의 project scope 제외, 같은 폴더는 대소문자 무시하고 인정, `jevInstalled` 위임 유지
- unit `test-system-one.js` 81 · `test-winpath.js` 25 통과
- `test-validate-settings.js`(electron 모듈)·`test-compress-hook.js`(`AOR/` 필요)는 이 환경에 의존물이 없어 실행 못 함 — **패치 전 베이스라인에서도 같은 이유로 동일하게 실패**함을 확인
- 설치본 검증: 패치한 `app.asar`을 실제 설치본에 넣고 기동 확인. 이 PC 기준 `chungi-t` 프로젝트에서 11개 항목이 전부 `설치됨`으로 계산됨(`superpowers`·`typesafe`는 user, 나머지 9개는 project)
- 동작 시뮬레이션 5종: 모두 설치됨 × (jev / start / manual), 설치 가능 있음 × (미선택 / 선택) — 라벨·활성 상태·클릭 결과 모두 기대와 일치

## 남은 것
- ~~E2E(`test:skills`)는 electron 필요 — 의존물 있는 환경에서 돌려야 함~~ → 2026-09-28 다른 PC에서 실행(아래)
- ~~Codex 리뷰 미진행~~ → 아래

## 리뷰·E2E (2026-09-28, 다른 PC에서 합친 뒤 · 0.2.6)
- E2E `test:skills` 첫 실행 5건 실패: 테스트가 체크박스를 `.checked =`로만 바꿔 `change`가 안 나고, 이번 변경으로 "고른 것이 없으면 설치 버튼 비활성"이 되어 클릭이 무시됨 → 테스트를 실제 클릭으로 수정(앱 동작은 맞음)
- Codex r1 조건부 승인 (logs/review/task-028_skills-installed-state.md)
  - Major: 설치 기록만 있으면 설치됨으로 봄 → 기록의 `installPath`가 Claude 플러그인 캐시 안에 있고 `.claude-plugin/plugin.json`이 있으며 `.orphaned_at` 표시가 없을 때만 인정(`installedCopyPresent`). 이 PC의 실제 기록 8개는 모두 조건 충족 확인
  - Major: 경로 대소문자 무시를 모든 OS에서 함 → Windows에서만(`foldPath`), `verifyInstalledCopy`도 같게
  - Minor: 프리셋이 잠긴(설치된) 행의 체크를 풂 → 잠긴 행은 건너뜀
- 테스트 추가: unit(오래된 기록·installPath 없음·캐시 밖·manifest 없음·orphaned·뒤의 정상 기록, 대소문자 구분 FS) · E2E(설치된 행은 체크+잠금, 프리셋 뒤에도 유지 — 수정을 끈 변이 실행에서 실패 확인)
