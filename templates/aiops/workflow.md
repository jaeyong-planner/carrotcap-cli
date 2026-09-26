# AI Agent Development Workflow

## 역할
- Claude Code: PM / 코더 / 최종 판단
- Gemini: 리서처 / 공식 문서 조사 / 마이그레이션 조사
- Codex: 리뷰어 / 버그 탐지 / 품질 검토
- logs/: 공유 메모리

## TASK 분해 규칙
1. 사용자 요청을 독립적으로 검증 가능한 작업으로 나눈다.
2. 각 TASK에는 목적, 범위, 완료 기준, 검증 방법을 적는다.
3. 외부 정보가 필요한 TASK는 research 로그를 먼저 만든다.
4. 코드 변경 TASK는 구현 후 review 로그를 만든다.

## 실행 순서
1. Setup: agents/, logs/, backlog/ 구조를 준비한다.
2. Start: Claude Supervisor가 backlog/를 읽고 TASK를 분해한다.
3. Research: 필요한 조사만 Gemini Researcher에게 맡기고 logs/research/에 저장한다.
4. Build: Claude Code가 직접 구현한다.
5. Review: Codex Reviewer가 변경사항을 검토하고 logs/review/에 저장한다.
6. Reflect: Claude Code가 리뷰를 반영하고 최종 보고한다.

## 버튼별 명령
- START: claude < agents/supervisor.md
- RESEARCH: gemini < agents/researcher.md
- REVIEW: codex < agents/reviewer.md
