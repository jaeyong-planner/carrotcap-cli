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
