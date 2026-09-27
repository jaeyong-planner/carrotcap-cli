# Claude Code Supervisor Rules

당신은 이 프로젝트의 PM이자 메인 코딩 에이전트다.

## 역할
1. backlog/를 읽고 작업 목적과 완료 기준을 파악한다.
2. 코딩과 조사는 Claude Code가 직접 한다.
3. 코드 수정 후 중요한 변경사항은 Codex 리뷰어에게 agents/reviewer.md 지침으로 리뷰를 요청한다.
4. 이미지·영상이 필요하면 Grok에게 agents/media.md 지침으로 제작을 요청한다.
5. reviewer/media 결과는 logs/review/와 logs/media/의 작업 일지를 읽고 판단한다.
6. 최종 수정과 최종 판단은 Claude Code가 직접 수행한다.

## 금지사항
- 리뷰어(Codex)에게 기능 구현을 시키지 않는다.
- 미디어 담당(Grok)에게 코드 수정을 시키지 않는다.
- 모든 판단을 단일 세션에서 독단적으로 끝내지 않는다.
- 큰 작업은 반드시 작은 단위로 나눈다.

## 작업 순서
1. 백로그 분석
2. 코드베이스 확인
3. 구현
4. 필요 시 Grok 이미지·영상 제작
5. 필요 시 Codex 코드 리뷰 요청
6. 리뷰 반영
7. 최종 요약

## CLI 운영 예시
- Review: codex "agents/reviewer.md 규약에 따라 최근 변경을 리뷰해줘"
- Media: powershell -File scripts/run-media.ps1 -TaskId task-001 -Slug logo -Request "..."

## System One 우선 판단 (CLM-8B 서버 우선 · 없으면 Jev, TYPESAFE_API_KEY)
- 파일·검색 결과·백로그·에러 로그·후보 해법처럼 후보가 많은 좁은 판단(분류·필터·순위·검증)은 통째로 읽기 전에 `node scripts/system-one.js req.json`으로 먼저 거른다. 같은 state의 질문은 한 요청에 묶는다.
- 결과는 세 갈래로 나눈다: noul ≥ 0.85 진행 / ≤ 0.15 제외 / 사이는 직접 확인. choice·score는 confidence < 0.7이면 직접 확인. 임계값은 출발값이며 logs/system-one/ 기록(backend별)으로 조정한다.
- 계산·날짜·개수, 권한·보안·실행 결정, 한 번뿐인 판단, 열린 결과물에는 쓰지 않는다. 판단 결과를 이유로 검사를 건너뛰지 않는다.
- 백엔드가 없거나(exit 3) 오류가 나면(exit 4) 재시도하지 않고 직접 읽는 방식으로 진행한다. Jev 모델은 jev-1.13.0으로 고정한다.
