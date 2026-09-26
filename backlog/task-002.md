# task-002 — Electron 보안 점검 (리서치 + 리뷰 dry-run)

## 상태
- 생성일: 2026-05-06
- PM: Claude Code
- 외부 에이전트: Gemini (researcher), Codex (reviewer)
- 우선순위: P1

## 목적
agent.txt 워크플로우의 첫 실전 dry-run.
현재 carrotcap-cli가 사용하는 **Electron 27.3.11**의 보안 위치를 점검하고,
**main.js / preload.js**의 IPC·셸 스폰 경로를 객관적으로 리뷰한다.

## 분배 작업

### A. Researcher (Gemini)
- 주제: Electron 27.3.11 → 최신 안정 버전 마이그레이션 영향도
- 산출물: `logs/research/task-002_electron-migration.md`
- 형식: `agents/researcher.md` §3 준수
- 범위:
  - 27 → 28/29/30/31/32/33+ 의 Breaking Changes
  - 알려진 CVE / 보안 권고
  - node-pty / child_process / contextBridge 호환성
  - 마이그레이션 난이도 등급

### B. Reviewer (Codex)
- 대상: `main.js` (654줄), `preload.js` (42줄)
- 산출물: `logs/review/task-002_main-preload-security.md`
- 형식: `agents/reviewer.md` §4 준수
- 중점 점검:
  - `webPreferences.sandbox: false` 정당성
  - `execFileSync`로 `HKCU\Environment` 레지스트리 수정 (main.js:78,87,91)
  - 27개 IPC 핸들러의 입력 검증
  - `pty:spawn` payload 신뢰 가정
  - `shell.showItemInFolder` 경로 검증 (Path Traversal)

## 검증 기준
1. 두 산출물이 모두 logs/ 하위에 저장되었다.
2. 각 산출물이 정해진 출력 형식을 따른다.
3. Claude(PM)가 두 결과를 종합해 다음 행동(task-003)을 도출한다.

## 다음 단계
- task-003: 리뷰에서 도출된 Critical/Major 이슈 수정 백로그
- task-004: 리서치에서 권고된 Electron 마이그레이션 백로그 (별건)
