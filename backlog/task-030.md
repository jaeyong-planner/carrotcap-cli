# task-030 — SETUP·흐름 진행을 단계 목록으로 (✓ / → / ○ / ✕)

## 요청 (2026-09-28)
task-020 확인 보고의 "(선택) 앱이 직접 쓰는 문구에도 같은 계층 스타일" → "이것도 보강해줘". 이어서 버전업·깃 업로드·재설치.
- 번호: 이 PC에서 task-028로 작업했으나, 같은 날 다른 PC에서 올린 task-028(SKILLS 설치 상태)·task-029(앱 아이콘)와 겹쳐 task-030으로 바꿈. 리뷰 기록도 task-030_*로 이름만 바꿈(내용 동일)

## 배경
- task-020에서 색·폰트는 제안 스타일대로 적용됨. 다만 AI DEV FLOW 아래 상태 줄(`#flow-status`)은 한 줄 문장이라, 흐름이 어디까지 됐고 어디서 멈췄는지 보이지 않았음
- 제안 스타일의 핵심: Task Tree + 상태 아이콘, 로그와 결과 분리, 짧은 문장

## 변경
- `renderer.js`: `startFlowRun` / `flowStep` / `endFlowRun` / `renderFlowRun`
  - SETUP: `◆ SETUP 2/2` — 프로젝트 폴더 → 워크플로우 준비, 끝에 "START로 시작하세요"
  - START·REVIEW·MEDIA: 워크플로우 준비 → 터미널 준비 → `<cli> 시작 (역할)`
  - CLM: 여기에 "판단 백엔드 확인"이 더해지고, 결과가 `판단 백엔드: CLM <주소>` 또는 `Jev (CLM 서버 꺼짐)`로 바뀜
  - 중간에 멈추면 그 단계가 ✕, 남은 단계는 ○ 그대로, 이유는 아래 `!` 줄(예: 다른 페인 선택, CLI 없음)
  - 진행 중 들어오는 일반 안내("터미널을 준비하는 중…", 폴더 안내)는 단계가 이미 보여 주므로 표시하지 않음. 결과(ok)·경고(warn)만 아래 줄로
  - DOM은 `textContent`로만 만듦(경로·오류 문자열이 HTML로 해석되지 않음)
- `styles.css`: 상태색 고정 — ✓ green · → cyan(강조) · ○ 회색 · ✕ red · ! yellow. 테마 토큰을 쓰므로 화이트 테마에서도 대비 유지
- QUICK CLI·키·스킬 등 한 줄 알림은 그대로(단계가 하나뿐)

## 리뷰 (Codex)
- r1 조건부 승인: 새 SETUP/흐름을 눌러도 기다리던 이전 흐름이 계속 진행해 CLI를 실행할 수 있음(Major), 이전 흐름의 경고가 새 목록에 섞임(Major), 진행 중 일반 안내 숨김(Minor)
  - 반영: 흐름마다 `current()`(자기가 최신 실행인지)를 모든 대기 뒤와 `writePty` 직전에 확인 → 밀려난 흐름은 아무 데도 실행하지 않음. `setFlowStatus(text, tone, run)`로 밀려난 실행의 메시지는 버림. Minor는 설계대로 유지(진행 안내는 단계가 대신 보여 줌)
- r2 **승인** (logs/review/task-030_flow-steps-r2.md)

## 테스트
- E2E winpath 23(+5, REVIEW 대기 중 SETUP → REVIEW 실행 안 됨·목록 오염 없음 포함. `current`를 끈 변이 실행에서 실패 1 → 2 확인): REVIEW `◆REVIEW 3/3` 모두 ✓ / SETUP 단독 `◆SETUP 2/2` + 다음 행동 / 다른 탭으로 바꿔 멈춘 흐름 → `done,fail,todo` + 이유
- E2E skills 94(+2): CLM(서버 꺼짐) → 4단계 ✓ + Jev 대체 `!` 줄 / CLM 서버 켜짐 → `판단 백엔드: CLM http://127.0.0.1:<port>`, 알림 줄 없음
- unit 271·67·94·81·25 그대로 통과

## 한계
- 각 CLI(claude·codex·grok)가 터미널에 찍는 출력 형식은 앱이 바꾸지 않음(task-020과 같음)
