# task-013 — 세션 이력 저장 · 이어하기 · 불필요 데이터 정리

## 상태
- 생성일: 2026-09-26
- 요청: "작업 중 끊겨도 이력을 기억해 기존 작업에서 이어가기", "세션이 끝나면 남길 것만 남기고 삭제, 데이터를 많이 남기지 말자"
- 우선순위: P1

## 설계 원칙
- 대화 내용은 각 CLI가 이미 저장한다 (claude/codex/grok 모두 이어하기 옵션 보유) → 앱은 **"어디서 무엇을 돌리고 있었나"만** 저장
- 터미널 출력·키 입력은 저장하지 않는다 (용량·개인정보)

## 저장 내용 (`<userData>/history/<프로젝트 경로 해시 16자>.json`, 1~2KB)
- 세션: id, startedAt, endedAt, clean(정상 종료 여부), lastTask(가장 최근 수정된 backlog/task-*.md), tabCount/paneCount/clis 요약
- 가장 최근 세션만: layout = 탭별 페인 목록 `{ mode, cli }` (탭 8·페인 8 상한)

## 동작
| 시점 | 동작 |
|---|---|
| 탭/페인 생성·닫기, CLI 실행, 폴더 변경 | 800ms 디바운스 후 `history:save` (허용된 작업 폴더만, 입력 whitelist 검증) |
| 프로젝트 폴더 열기 | 이 실행 이전 세션 중 layout이 있는 최신 것을 "이어하기" 상자로 제안 (정상/비정상 종료, 탭·페인 수, CLI, 마지막 task 표시) |
| 이어하기 | 배치 재구성 → PTY 준비 후 `claude --continue` / `codex resume --last` / `grok --continue` 입력, 빈 시작 탭은 닫음, 이전 layout 삭제 |
| 새로 시작 | 이전 layout 삭제 |
| 정상 종료 (`before-quit`) | 이번 실행 세션 clean 표시, 최신 세션만 layout 유지, 최대 5개 |
| 비정상 종료 | 아무것도 안 함 → 다음 실행에서 "비정상 종료"로 제안 |
| 앱 시작 | 30일 지난 기록 · 폴더가 사라진 프로젝트 기록 · 형식이 다른 파일 삭제, 사라진 작업 폴더를 허용 목록 파일에서 제거 |

## 추가 정리 (프로젝트 쪽)
- `run-reviewer.ps1` / `run-media.ps1`: 성공 시 원본 CLI stdout 로그 삭제 (`-KeepLog`로 유지, 실패 시 항상 유지)
- 이 저장소 `logs/review/`의 기존 Codex stdout 로그 12개(3.8MB, git 제외 대상, 모두 보고서 .md 존재) 삭제

## 검증
- `npm test` 147/147 — layout 정제, 5개 상한, 같은 세션 갱신, finalize(최신만 layout), 제안 대상 선택, dismiss, 30일 만료
- `npm run test:resume` 18/18 — 실제 앱 3회 실행: 기록 → 강제 종료 → "비정상 종료" 제안 → 이어하기(탭 1·페인 2, `--continue` 입력) → 정상 종료 후 압축 → 새로 시작

## 리뷰 반영 r1 (logs/review/task-012-013_cli-history.md — ⚠️ 조건부 승인, Critical 0 / Major 4 / Minor 3)
- 010/011 Major 4건은 모두 RESOLVED 확인
- Major: run-reviewer/run-media `TaskId`·`Slug` 경로 탈출 → `ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')` (`..\`, 절대경로, `.` 거부 확인)
- Major: run-reviewer가 실패해도 이전 보고서를 성공처럼 저장 → 실행 전 기존 보고서 삭제 + Codex exit code 검사
- Major: 프로젝트 전환 중 이력 섞임 → 저장 예약·조회·복원·dismiss를 시작 시점의 root에 묶음, 폴더 변경 시 이전 root 예약분 즉시 저장
- Major: 디스크의 이력 파일 재검증 → `sanitizeHistoryRecord`(세션 id·ISO 시각·task 이름·CLI 목록·layout 8×8·개수 clamp)
- Minor: settings 저장 시 `cli:status` 캐시 무효화, `settingsVersion`은 정수일 때만 인정, 로그 삭제 실패 시 경고
- 결과: `npm test` 163/163, smoke 46/46, resume 18/18

## 리뷰 반영 r2 (logs/review/task-012-013-r2_review-reflection.md — ⚠️ 조건부 승인, 이전 Major 3 RESOLVED·1 PARTIAL, 신규 Major 3 / Minor 1)
- 복원 도중 프로젝트 전환: 즉시 중단, 원래 프로젝트 기록 삭제·성공 표시 안 함 (PARTIAL → 해결)
- 800ms 안에 종료 시 미저장: 첫 변경은 즉시 저장(이후 800ms 묶음), 창 닫힘 시 flush, 종료 중 도착한 저장은 다시 정상 종료로 확정
- macOS/Linux: 명령 조합을 플랫폼별로 (`cd -- '<dir>' && '<cmd>' '<arg>'`) — macOS 실기 미검증
- 이력 파일 64KB 초과 시 읽지 않고 부팅 때 삭제
- 결과: `npm test` 163/163, smoke 46/46, resume 21/21 (즉시 종료·손상/거대 파일 정리 시나리오 추가)
