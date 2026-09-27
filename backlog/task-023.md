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

## Codex r1 (⚠️ 조건부, Major 4 / Minor 3) 반영
- 패키징: `renderer-skills.js`를 build.files에 추가 — 패키지 앱으로 E2E 31/31 (`CC_APP_EXE`)
- 마켓 추가 fallback에 `--scope project`
- 공급망 확인: 로컬 공식 마켓 사본에서 각 플러그인 구성(스킬·명령·에이전트 수, 훅과 실행 명령, MCP 서버 명령, 버전 / 외부 저장소·고정 커밋)을 읽어 창에 표시. 예) security-guidance 훅 9개(파이썬 실행), playwright `npx @playwright/mcp@latest`, superpowers `obra/superpowers @ 896224c`
- 외부 제작(superpowers·playwright)은 프리셋에서 빠지고, 직접 체크 + "출처·실행 명령 확인" 동의가 있어야 설치(main도 동의 없으면 거부)
- Windows 시간 초과: `taskkill /T /F`로 프로세스 트리 종료, 종료 후에만 다음 설치
- 줄바꿈 유지(CRLF 파일은 CRLF), 하드 링크·링크·폴더인 CLAUDE.md 거부, 규칙 쓰기 실패 시 `rulesPending` 기록 → START가 다시 제안
- 테스트: test-skills 23, test:skills 31 (동의 흐름, 동의 없는 IPC 거부, 마켓 추가 scope, 하드 링크 거부·원본 무변경·재제안)

## Codex r2 (⚠️ 조건부, Major 1 / Minor 2) 반영
- 원격(외부 저장소) 플러그인: "구성 불러오기"로 고정 커밋의 파일 목록·plugin.json·hooks.json·.mcp.json을 GitHub에서 읽어 스킬·명령·에이전트 수, 훅/MCP 실행 명령, 스크립트 파일 수, 버전을 표시. 확인 전에는 동의 체크 자체가 비활성, main도 거부. 실측: superpowers v6.0.3 @896224c — 스킬 14, SessionStart 훅 1개(`run-hook.cmd session-start`), 스크립트 51개
- 내용을 확인할 수 없는 외부 항목(마켓 정보 없음·GitHub 아닌 원격·목록 잘림)은 설치 불가
- 쓰기 직후 프로젝트 밖으로 벗어난 것이 확인되면 방금 쓴 내용을 되돌리거나(기존 파일) 지움(새 파일)
- 시간 초과 테스트는 손자 프로세스(cmd 아래 powershell)로 — 트리 종료 없이는 살아남는 것을 먼저 확인
- E2E: 로컬 마켓 사본으로 구성 표시, playwright 동의 흐름, superpowers 확인 전 거부(동의해도), 동시 설치 거부, 창이 열려 있는 동안 브라우저 뷰 크기 0
- 테스트: test-skills 32, test:skills 38

## Codex r3 (⚠️ 조건부, Major 1 / Minor 1) 반영
- 내용 점검: 플러그인의 모든 SKILL.md·명령·에이전트 문서와 모든 스크립트 본문을 읽고(원격은 고정 커밋, 로컬은 마켓 사본) 네트워크 / 파일 삭제 / 환경변수·자격증명 / 셸·프로그램 실행을 줄 단위로 찾아 `파일:줄 — 내용`으로 보여 줌
- 훅·MCP가 직접 실행하는 파일(`${CLAUDE_PLUGIN_ROOT}/...`)은 본문 전체를 창에서 펼쳐 볼 수 있음
- npx/uvx/docker처럼 실행할 때 외부 코드를 받아 오는 명령은 "본문 확인 불가"로 따로 경고
- 확인 불가 → 설치 불가: 본문을 못 읽은 파일, 바이너리 실행 파일, 훅이 가리키는 없는 파일, 파일 300개·8MB 초과, 링크 파일
- 실측: superpowers @896224c — 본문 70개(478KB) 확인, 훅 파일 hooks/run-hook.cmd 본문 표시
- 테스트: test-skills 45, test:skills 40

## Codex r4 (⚠️ 조건부, Major 1 / Minor 1) 반영
- 점검 범위: 확장자와 상관없이 이미지·글꼴·미디어를 뺀 모든 파일 본문을 읽음 (확장자 없는 실행 파일, 설정 파일 포함). 셔뱅(`#!`)이나 확장자 없는 파일은 스크립트로 보고 URL도 잡음
- package.json의 설치 때 자동 실행 스크립트(preinstall/install/postinstall/prepare 등)는 "설치 때 자동 실행"으로 따로 표시
- 내용에 NUL 바이트가 있는 파일(확장자로 안 드러나는 바이너리)은 확인 불가로 처리해 설치 거부
- 창 표시: "파일 N개 전체 본문 확인, 이미지·글꼴 M개 제외"
- E2E 원격 성공 흐름: 구성 불러오기 → 점검 결과·훅 스크립트 본문 표시 → 동의 → 고정 argv로 설치. 확인한 뒤 목록의 커밋이 바뀌면 설치 거부. GitHub 응답은 개발 트리에서만 쓰는 로컬 fixture(`CARROTCAP_TEST_GITHUB_FIXTURE`, 패키지 앱은 무시)
- 테스트: test-skills 50, test:skills 47
