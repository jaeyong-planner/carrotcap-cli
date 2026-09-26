# AI Agent Development Workflow

## 역할
- Claude Code: PM / 코딩 / 조사 / 최종 판단
- Codex: 리뷰어 / 버그 탐지 / 품질 검토
- Grok: 미디어 / 이미지·영상 제작 (요청이 있을 때만)
- logs/: 공유 메모리 (review/, media/)

## TASK 분해 규칙
1. 사용자 요청을 독립적으로 검증 가능한 작업으로 나눈다.
2. 각 TASK에는 목적, 범위, 완료 기준, 검증 방법을 적는다.
3. 코드 변경 TASK는 구현 후 review 로그를 만든다.
4. 이미지·영상이 필요한 TASK는 media 로그와 assets/generated/ 결과물을 남긴다.

## 실행 순서
1. Setup: agents/, logs/, backlog/ 구조를 준비한다.
2. Start: Claude Supervisor가 backlog/를 읽고 TASK를 분해한 뒤 직접 구현한다.
3. Media: 필요한 이미지·영상만 Grok에게 맡긴다.
4. Review: Codex Reviewer가 변경사항을 검토하고 logs/review/에 저장한다.
5. Reflect: Claude Code가 리뷰를 반영하고 최종 보고한다.

## 버튼별 명령
- START: claude — agents/supervisor.md 절차로 시작
- REVIEW: codex — agents/reviewer.md 규약으로 최근 변경 리뷰
- MEDIA: grok — agents/media.md 규약으로 대기, 요청 시 /imagine · /imagine-video
