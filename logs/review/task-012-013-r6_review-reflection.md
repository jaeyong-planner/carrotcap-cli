# Review Report — task-012-013 (f169fdb, 1035c34, bf3589e)

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `renderer.js`, `preload.js`, `scripts/run-media.ps1`, `scripts/run-reviewer.ps1`, 관련 테스트
- 변경 라인 수: +1,197 / -72
- 리뷰 시점: 2026-09-26T04:41:33Z

## 2. 전체 판단

- ✅ 승인
- 설정 마이그레이션, PowerShell 인용, history IPC·경로 검증, 복원 중 프로젝트 전환, 로그 정리 및 개인정보 범위가 요구사항에 맞게 안전하게 구현되었습니다.

- r5 Major — 이전 프로젝트 pane/tab 종료 후 stale layout 재제안: **RESOLVED** (`renderer.js:141-155`, `renderer.js:306-350`, `renderer.js:522-527`)
- r5 Minor — `run-media.ps1`의 backup 이동 뒤 temp-file 생성 실패 시 복구 누락: **RESOLVED** (`scripts/run-media.ps1:105-128`)

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- 없음.

## 5. Minor 이슈

- 없음.

## 6. Optional 제안

- [scripts/test-electron-resume.js:44-137] 프로젝트 A에서 B로 전환한 뒤 A pane/tab을 모두 닫고 A를 다시 열었을 때 stale layout이 제안되지 않는 회귀 테스트가 없습니다. → `saveHistoryForRoots()` 동작을 직접 검증하는 A/B 프로젝트 E2E 시나리오를 추가해야 합니다.
- [scripts/test-run-media.ps1:50-65] 기존 log backup 후 temp-file 생성 또는 prompt-file 쓰기 실패 시 원래 log 복구를 검증하는 테스트가 없습니다. → 파일 생성 API 실패를 주입하는 테스트 경로를 추가해야 합니다.
- [main.js:1393-1412] POSIX에서 `/usr/bin/which`가 없는 환경은 설치된 CLI를 미설치로 표시할 수 있습니다. → Linux/macOS 지원 확대 시 `command -v` 또는 platform별 탐색 구현을 검토해야 합니다.

## 7. 최종 권고

- 병합 가능.
- `migrateSettings()`는 정수 `settingsVersion`만 신뢰하며, 구형 Gemini/Antigravity/agy 항목만 제거하고 Grok 재시드는 한 번만 수행합니다 (`main.js:156-171`).
- renderer의 CLI·flow prompt·프로젝트 경로는 PowerShell single-quote escaping 및 `Set-Location -LiteralPath`로 전달되어 command injection 경로가 없습니다 (`renderer.js:943-954`, `renderer.js:1177-1182`).
- `cli:status`는 `where.exe`를 `execFile` 인자로 호출하고 settings 저장 시 캐시를 무효화합니다 (`main.js:1117-1120`, `main.js:1393-1415`).
- history는 허용 workspace, hash 파일명, 64KB 상한, plain-directory 검사, atomic write 및 일반 파일만의 prune으로 제한됩니다 (`main.js:1253-1387`).
- history에는 layout·CLI·작업 요약만 저장하며 terminal output·keystroke는 저장하지 않습니다 (`main.js:326-407`, `renderer.js:476-507`).
- 배포 전 writable CI에서 `npm test`, `npm run test:smoke`, `npm run test:resume`, `npm run test:media`를 실행합니다.