# task-016 — AOR 엔진 연결 (Cream CLI 0.3.2 엔진)

## 목적
번들 AOR 폴더에 실행 파일만 있고 스크립트가 없어 AOR/AIOps 페인이 항상 일반 셸로 열렸다. 설치된 Cream CLI의 완전한 엔진을 번들에 넣어 실제로 연결한다.

## 조사 결과 (근거)
- 엔진 실행 파일은 이미 동일(sha256 `554c7018…`). 빠진 것: `engine/windows/_internal/*.ps1`, `shims/*.cmd`, `support/_internal/*.js`, `os/windows/*.bat`
- 엔진이 실제로 하는 일: 명령 출력 압축(`npm test` 9KB→1.3KB, 228줄→9줄), 대시보드, 세션 리포트, Claude 폴더 신뢰 자동 처리
- **대시보드의 "절감 3.26억 토큰"은 AOR 효과가 아님**: importer가 Claude의 프롬프트 캐시 읽기(`cache_read_input_tokens`)를 `tokensSaved`로 기록. 실제 압축 절감은 11건·약 3.5만 토큰
- **엔진만 연결하면 모델 토큰은 줄지 않음**: Claude Code는 Git Bash로 명령을 실행해 `.cmd` 셔임을 쓰지 않고, 셔임도 stdout이 리디렉트되면 그대로 통과시킨다 → 사람이 콘솔에서 친 명령만 압축 (task-017에서 해결)

## 변경
| 항목 | 내용 |
|---|---|
| 번들 | Cream 스크립트를 원본 그대로 커밋(2231d66) 후 아래만 수정 |
| 절감 표시 정직화 | importer: 캐시 읽기는 사용량으로만 기록(`tokensSaved=0`). 대시보드: "압축 절감"과 "Claude 캐시 읽기(AOR 절감 아님)" 분리, 옛 기록도 재계산. 세션 리포트: 압축 기록만 합산 |
| 콘솔 셔임 기본 OFF | `aor.consoleShims`(기본 false). 셔임은 명령이 끝날 때까지 출력을 버퍼링해 `npm run dev`가 아무것도 안 보이고, 에이전트 토큰에는 효과가 없다. `-ShimDir` 선택 인자화 |
| 데이터 정리 | `pruneAorRuntime`: raw 로그 최근 200개·7일, 리포트 20개, metrics 30일. 엔진 이름 패턴의 일반 파일만, 링크 미추적. 페인 시작 시 엔진별 1시간 1회 |
| 테스트 격리 | E2E는 `CLAUDE_CONFIG_DIR`을 임시 폴더로 — 셸이 폴더 신뢰를 기록해도 실제 `~/.claude.json`에 쓰지 않음 |

## 한계 / 리스크
- 셸 시작 시 선택한 프로젝트 폴더를 Claude 신뢰 목록에 자동 추가(Cream과 동일 동작, 사용자가 고른 폴더만)
- 페인마다 PowerShell 백그라운드 작업 2개(15초 heartbeat, 60초 사용량 import)
- macOS 엔진 스크립트는 번들에 없음 (Windows만 연결)

## 테스트
- unit 206, test:aor 15(엔진 부팅·셔임 OFF·격리된 신뢰 기록), smoke 50, resume 27, browser 64
