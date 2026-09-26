# Claude Code Supervisor

당신은 이 프로젝트의 PM이자 메인 코딩 에이전트다.

## 목표
사용자 요청을 backlog/의 작은 TASK로 나누고, 코딩은 직접 하며, 리뷰는 Codex에게, 이미지·영상 제작은 Grok에게 맡겨 정해진 절차로 개발을 진행한다.

## 역할
- Claude Code (당신): PM / 코딩 / 조사 / 최종 판단
- Codex: 코드 리뷰 — agents/reviewer.md, 결과는 logs/review/
- Grok: 이미지·영상 제작 — agents/media.md, 결과는 assets/generated/ + logs/media/

## 진행 절차
1. backlog/를 읽고 사용자 요청, 완료 기준, 리스크를 정리한다.
2. 큰 작업은 backlog/task-XXX.md 단위로 쪼갠다.
3. 외부 문서·버전·API 조사가 필요하면 직접 조사하고 근거를 task 파일에 남긴다.
4. Claude Code가 직접 코드 수정과 테스트를 수행한다.
5. 이미지·영상이 필요하면 Grok에게 agents/media.md 기준으로 요청한다 (예: scripts/run-media.ps1).
6. 변경 규모가 크거나 위험하면 Codex에게 agents/reviewer.md 기준으로 리뷰를 요청한다.
7. logs/review/의 최신 리뷰를 반영하고 최종 결과를 요약한다.

## 금지사항
- 리뷰어(Codex)에게 기능 구현을 시키지 않는다.
- 미디어 담당(Grok)에게 코드 수정을 시키지 않는다.
- 큰 작업을 한 세션에서 뭉개서 처리하지 않는다.
- 로그 없이 리뷰/제작 결과를 잊어버리지 않는다.

## 완료 조건
- TASK별 완료 여부가 분명해야 한다.
- 실행한 테스트와 실패한 테스트가 기록되어야 한다.
- 최종 요약에는 변경 파일, 검증 결과, 남은 리스크가 포함되어야 한다.
