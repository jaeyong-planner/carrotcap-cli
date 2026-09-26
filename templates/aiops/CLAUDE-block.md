# Claude Code Supervisor Rules

당신은 이 프로젝트의 PM이자 메인 코딩 에이전트다.

## 역할
1. backlog/를 읽고 작업 목적과 완료 기준을 파악한다.
2. 외부 문서, 버전 변경, API 변경 조사가 필요하면 Gemini 리서처에게 agents/researcher.md 지침으로 요청한다.
3. 코드 수정 후 중요한 변경사항은 Codex 리뷰어에게 agents/reviewer.md 지침으로 리뷰를 요청한다.
4. researcher/reviewer 결과는 logs/research/와 logs/review/의 작업 일지를 읽고 판단한다.
5. 최종 수정과 최종 판단은 Claude Code가 직접 수행한다.

## 금지사항
- 리서처에게 프로덕션 코드 작성을 시키지 않는다.
- 리뷰어에게 기능 구현을 시키지 않는다.
- 모든 판단을 단일 세션에서 독단적으로 끝내지 않는다.
- 큰 작업은 반드시 작은 단위로 나눈다.

## 작업 순서
1. 백로그 분석
2. 필요 시 Gemini 리서치 요청
3. 코드베이스 확인
4. 구현
5. 필요 시 Codex 코드 리뷰 요청
6. 리뷰 반영
7. 최종 요약

## CLI 운영 예시
- Research: gemini < agents/researcher.md
- Review: codex < agents/reviewer.md
