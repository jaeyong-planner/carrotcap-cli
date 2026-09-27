# task-025 — System One 판단(CLM-8B 우선 · Jev 대체): SKILLS 카탈로그·버튼·규칙·키 파일

## 요청 (2026-09-28)
1. SKILLS 카탈로그에 Jev 추가 (task-024 후속)
2. JEV 버튼을 CLI 줄·워크플로우 줄 모두에 추가
3. 「Jev 기술 분석」 실행가이드(PDF 43쪽)를 근거로, 코드 작업 때 Jev로 판단을 먼저 해서 토큰을 아끼고 개발을 편하게 하는 규칙을 추가
4. AI DEV FLOW에는 JEV 대신 CLM-8B(Stanford·NVIDIA, Apache 2.0) 로직을 자동 세팅 → 사용자 선택: **CLM 우선 + Jev 자동 대체**
5. Jev API 키 넣을 곳을 메모장으로 열기
6. 버전업 후 설치 파일 생성

## 조사 (근거)
- Jev: `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer`, noul/choice/score, 오류 401/422/429/529 (docs.typesafe.ai/api). 플러그인 `typesafe@typesafe-ai`는 마켓 루트(`source: "./"`)에 있음
- CLM: README 기준 `pip install contrastive-lm`, `vllm serve Qwen/Qwen3-8B --runner pooling --port 8090`, `clm-serve`(:8700). TypeSafe 요청을 그대로 받음, `CLM_API_KEY`는 선택. 하드웨어 요구는 README에 없음. Qwen3-8B bf16 ≈ 16GB, vLLM은 Linux용
- 이 PC: RTX 4050 Laptop 6GB, Windows → CLM 로컬 GPU 실행 불가. 그래서 "서버가 있으면 CLM, 없으면 Jev" 구조를 택함
- 가이드 핵심: 좁은 판단은 모델·계산/권한은 코드, 같은 state 질문 묶기, 세 갈래(진행/보류/제외), 버전 고정, 한국어·인젝션 주의, 자동 처리율과 오류율은 짝으로 봄

## 변경
- `main-skills.js`: 항목별 마켓(`marketOf`/`pluginKey`), `typesafe` 항목(외부 제작), `"./"` 출처 검사, `skills:add-marketplace`(목록만 복제, 설치·실행 없음), `skills:jev-status`, 마켓 목록 정확 비교
- `renderer-skills.js`: 이름(label), "마켓 추가" 버튼, `open({select, reason:'jev'})`
- `index.html`/`styles.css`/`renderer.js`: QUICK CLI `JEV`(claude + `/typesafe:typesafe-ai`), AI DEV FLOW `CLM`(CLM 서버가 켜져 있으면 CLM, 없으면 Jev 확인·SKILLS 설치 창), CLI 줄 2×2
- `scripts/system-one.js` (새로 만듦): 무의존 CLI. 백엔드 auto(CLM→Jev, **연결이 안 될 때만** 대체)/clm/jev, CLM URL 규칙(http는 루프백만, 원격은 https), 429/529 재시도, 512KB 제한, `logs/system-one/usage.jsonl`(본문·키 없음). SETUP이 프로젝트에 복사
- `main.js`: `settings.systemOne.clmUrl` 화이트리스트, 터미널 env에 `CLM_URL`, `system-one:clm-status`, `%USERPROFILE%\.carrotcap\keys.env`(TYPESAFE_API_KEY·CLM_API_KEY만, 터미널을 열 때마다 읽음)
- `scripts/setup-clm.sh` (새로 만듦): Linux/WSL GPU 서버용 install/serve (README 명령만 사용)
- `CLAUDE.md` §8, `templates/aiops/CLAUDE-block.md`: System One 우선 판단 규칙

## 테스트
- unit: settings 265 · compress 67 · skills 94 · system-one 81 (키·state를 model/answers/usage/질문 id에 되돌려 보내는 서버, 조용한 CLM, 버전 고정 포함)
- E2E: skills 91(CLM 꺼짐 → Jev 설치 창 → 마켓 추가 → 동의 → 설치 → 시작 / CLI JEV / 🔑 keys.env / CLM 404·401·500은 꺼짐 / CLM 켜짐 → CLM만 / 터미널 CLM_URL / SETUP이 system-one.js·setup-clm.sh 복사), smoke 54, browser 94(2회), resume 27, aor 33, copy 16, launchers 9

## 리뷰 (Codex)
- r1 반려: 오류 본문 그대로 출력(Critical), 키 파일 열기 없음·setup 준비 실패 무시(Major) → 고정 문구, 🔑 버튼, 준비 실패 시 종료
- r2 반려: 정상 응답의 answers/usage/model 반사, setup-clm.sh 미배포 → 필드별 복사·범위 검사, 빌드·SETUP 복사, 2xx만 CLM
- r3 반려: 짧은 키가 model로 반사, 질문 id 그대로 전송, jev-latest 허용 → model은 고정값, q0… 전송, 버전 고정
- r4 반려: 원래 질문 id가 로그·메시지에 남음 → 위치(#1)와 type만 기록
- r5 **승인** (logs/review/task-025_system-one-r5.md)
- 실연결(사용자 키, 2026-09-28): auto → CLM ECONNREFUSED → Jev 대체, `billing_history` 1.00 · 환불 noul 0.03 · 220~319ms · 입력 458토큰 (가이드 9.7과 같은 결과)

## 한계
- CLM 실제 서버로는 검증하지 않음(fake 서버로만 확인). 응답 형식은 README 예시와 같다고 가정
- `setup-clm.sh`는 GPU가 없는 이 PC에서 실행해 보지 않음
- smoke의 "shell exit" 2개 항목은 고정 대기(2.5초) 때문에 부하가 있을 때 실패함. 변경 전 HEAD에서도 3회 모두 같은 항목이 실패해(2026-09-28, 별도 worktree에서 확인) 이번 변경과 관계없음
- 임계값(0.85/0.15/0.7)은 출발값이며 검증된 값이 아님
