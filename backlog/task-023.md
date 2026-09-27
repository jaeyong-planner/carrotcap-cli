# task-023 — 프로젝트 스킬(플러그인) 자동 세팅, START 연동

## 요청
추천된 스킬 구성(superpowers·code-review·systematic-debugging·frontend-design·playwright 등)과 적용 구조를 자동으로 세팅해 개발에 쓰도록. START 클릭 시 세팅해도 됨. (함께 받은 안내: 설치 전 SKILL.md·셸 명령·네트워크·파일 삭제·키 접근 확인, 별 개수만으로 안전 판단 금지)

## 조사 (근거)
- 이 PC에 공식 마켓 `claude-plugins-official`(anthropics/claude-plugins-official, 243개)이 이미 등록 — superpowers(obra, 커밋 고정), code-review·feature-dev·frontend-design·pr-review-toolkit·security-guidance·commit-commands·claude-md-management·skill-creator(Anthropic), playwright(Microsoft MCP) 포함. systematic-debugging은 superpowers 안의 스킬
- CLI(2.1.195): `claude plugin install <p>@<mkt> --scope project`, `claude plugin marketplace add <src> --scope project`, `claude plugin marketplace list`
- 프로젝트 설정의 `enabledPlugins`만으로는 설치되지 않음(문서) → CLI로 설치

## 설계
- 조용히 설치하지 않음: 창에서 만든 곳·출처·용도를 보여 주고 사용자가 고른 것만 설치. 외부 제작 표시(superpowers·playwright)
- 프리셋: 웹 개발(기본) / 백엔드·API / 문서·기획
- 프로젝트 범위 설치(다른 프로젝트 영향 없음), 실행 폴더 = 선택한 프로젝트(허용 목록 안)
- main은 카탈로그 id만 받음, 명령 인자는 상수+id(렌더러 텍스트 없음). claude 명령은 settings의 cli.claude(이름→where, 또는 전체 경로)
- 적용 구조: 프로젝트 CLAUDE.md에 `CARROTCAP:SKILLS` 블록(설치된 것만 사용 규칙), 재실행 시 교체. `.carrotcap/skills.json`에 설치 목록·건너뜀 기록
- START: 프로젝트에서 처음이면 창 → "설치하고 시작 / 건너뛰고 시작 / 다시 묻지 않음", 설치 후 바로 시작한 claude 세션에 적용. SKILLS 버튼으로 언제든 다시

## 한계
- 실제 설치는 사용자가 버튼을 눌렀을 때 GitHub에서 받아 옴 — 이번 작업에서 실제 설치는 실행하지 않음(가짜 claude로 검증)
- document-skills는 공식 마켓에 없어(anthropics/skills 별도 마켓) 제외

## 테스트
- test-skills 14(카탈로그·id 필터·CLAUDE.md 블록 병합), test:skills E2E 21(START 첫 실행 창, 선택 전 실행 없음, 프리셋, 부분 실패 처리, project scope·폴더, skills.json·CLAUDE.md, 두 번째 START 안 물음, SKILLS 재실행 블록 1개, 잘못된 id·허용 밖 폴더 거부, 다시 묻지 않음)
- 전체: unit 252+67+14, smoke 53, browser 94, resume 27, aor 33, copy 16
