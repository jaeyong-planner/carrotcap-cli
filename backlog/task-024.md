# task-024 — Jev(TypeSafe) 설치 및 작업 연동

## 요청
jev를 설치하고 작업에 연동.

## 조사 (근거)
- Jev = TypeSafe AI의 System One 판단 모델. 자연어+상태를 받아 타입이 정해진 답과 확률을 돌려줌(글 생성 X)
- 공식 설치: `typesafe-ai/skills` 저장소(GitHub, 공식) — https://docs.typesafe.ai/agent-skill
- npm `jev`(0.0.0)·jevtypesafeai.com은 공식이 아님 → 사용하지 않음
- 인증: 환경변수 `TYPESAFE_API_KEY`, 키 발급 https://console.typesafe.ai/keys

## 실행
- `claude plugin marketplace add typesafe-ai/skills`
- `claude plugin install typesafe@typesafe-ai` → typesafe 0.5.7, scope: user, enabled
- 스킬 호출: `/typesafe:typesafe-ai`
- CLAUDE.md §7.1 역할 표에 "판단 모델" 행 추가

## 한계
- API 키 미설정(2026-09-28 기준) — 키 설정 전에는 실제 Jev 호출 불가, 문서·설계 가이드만 동작
- user 범위 설치(모든 프로젝트에 보임). 앱 SKILLS 카탈로그(task-023)에는 아직 없음
- Codex(리뷰어)에는 설치하지 않음

## 업데이트
`claude plugin marketplace update typesafe-ai && claude plugin update typesafe@typesafe-ai`

## 후속 (2026-09-28)
- API 키: 사용자가 `%USERPROFILE%\.carrotcap\keys.env`에 넣음. 실연결 확인됨 (task-025)
- SKILLS 카탈로그 추가, 버튼, System One 규칙(CLM 우선 · Jev 대체) → task-025
