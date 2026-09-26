# task-001 — 멀티 에이전트 감독자 구조 부트스트랩

## 상태
- 생성일: 2026-05-06
- 담당: Claude Code (PM)
- 우선순위: P1

## 목적
agent.txt 가이드에 따라 carrotcap-cli 프로젝트에
PM(Claude) + Researcher(Gemini) + Reviewer(Codex) 3-Agent 구조를 도입한다.

## 범위
- [x] 폴더 구조 생성: `agents/`, `logs/research/`, `logs/review/`, `backlog/`
- [x] `agents/researcher.md` 작성
- [x] `agents/reviewer.md` 작성
- [x] `CLAUDE.md`에 §7 Supervisor Rules 추가 (기존 AOR 규칙 보존)
- [x] 샘플 백로그(`backlog/task-001.md`) 생성
- [ ] 외부 에이전트 호출 방식 검증 (예: Gemini CLI / Codex CLI 통합)
- [ ] 첫 실전 작업으로 워크플로우 dry-run

## 비범위 (Out of Scope)
- 기존 Electron 메인/렌더러 코드 변경
- AOR 라우팅 로직 수정
- 빌드 파이프라인 변경

## 검증 기준
1. `carrotcap-cli/agents/`, `carrotcap-cli/logs/research/`, `carrotcap-cli/logs/review/`, `carrotcap-cli/backlog/` 디렉토리가 모두 존재한다.
2. `CLAUDE.md`에 §1~§6(기존)이 그대로 남아있고 §7이 추가되어 있다.
3. `agents/researcher.md`, `agents/reviewer.md`가 agent.txt §4·§5의 규약을 모두 포함한다.

## 다음 작업 후보
- task-002: 실제 Gemini CLI 연동 스크립트 (`scripts/run-researcher.ps1`)
- task-003: Codex CLI 연동 스크립트 (`scripts/run-reviewer.ps1`)
- task-004: 워크플로우 dry-run으로 첫 리서치+리뷰 실행 후 logs/ 채우기

## 참고
- 가이드 원본: `C:\Users\user\Desktop\carrotcap-cli\agent.txt`
- 운영 규칙: `CLAUDE.md` §7
