# task-017 — Claude 출력 압축 훅 (실제 토큰 절감)

## 목적
에이전트가 실행한 명령 출력이 모델에 들어가기 전에 AOR 엔진으로 요약되게 한다. task-016 조사에서 엔진 연결만으로는 모델 토큰이 줄지 않음을 확인.

## 설계 결정 (실측 근거)
1. **PreToolUse로 명령을 감싸는 방식 → 폐기.** 실제 `claude -p`로 시험: 권한 검사가 *바뀐* 명령에 대해 이뤄지고, `$(...)`·`{ }`가 있어 "Contains shell syntax that cannot be statically analyzed"로 거부 → 대화형에서는 매번 권한 프롬프트
2. **PostToolUse `updatedToolOutput` 채택.** 설치된 Claude Code 2.1.195 바이너리에 "Replaces the tool output before it is sent to the model … works for all tools" 확인. 명령은 그대로 실행 → 권한 규칙·`cd`·스트리밍 영향 없음
3. **실패한 명령은 압축 불가.** 종료 코드≠0이면 `PostToolUseFailure`가 발생하고 이 이벤트는 `additionalContext`만 지원(실측·바이너리 스키마 확인) → 실패 출력은 모델에 전체 전달
4. 엔진 요약이 실패 줄을 빠뜨리는 경우 발견(통과 종료 코드의 FAIL 줄) → FAIL/ERROR/Traceback 등 줄은 최대 30줄 원문 보존

## 구현
- `AOR/carrotcap/compress-hook.js`: Bash 성공 결과 중 테스트·빌드·설치 명령(`npm test/ci/install/run build…`, pytest, cargo, go, tsc, eslint, dotnet 등)만, 출력이 2KB 또는 40줄 초과일 때 엔진 요약 + 보존 줄 + raw 로그 경로로 교체. 파이프·리디렉트·백그라운드·dev/watch·작은 출력은 그대로. 오류 시 무조건 원본(fail-open). `CARROTCAP_AOR_COMPRESS=0`으로 끔
- 적용 범위: CARROTCAP에서 띄운 claude만 `--settings <userData>/aor-hook/claude-settings.json` (사용자 `~/.claude` 설정 무수정, 훅은 기존 훅에 추가됨)
  - CLI 버튼(명령이 실제 `claude`일 때만), `cli` 모드 스폰, AOR 셸의 `claude` 래퍼(`CARROTCAP_CLAUDE_SETTINGS`, 서브커맨드·사용자 `--settings` 제외)
- 설정 `aor.compressHook`(기본 true). node가 PATH에 없으면 자동 비활성

## 실측
- 합성 테스트 출력 17,392자 → 765자, 실제 Claude(haiku)가 요약을 받고 FAIL 줄도 인용, `Bash(npm test)` 허용 규칙 정상 적용(거부·프롬프트 없음)
- 이 저장소 `npm test`: 9,546B → 1,425B

## 한계
- 성공한 실행만 압축. 실패 출력은 그대로
- 요약 품질은 엔진 휴리스틱 의존 (예: 통과한 실행의 headline이 테스트가 일부러 찍은 "failed" 로그 줄)
- raw 로그는 엔진 폴더에 있어 모델이 전체를 읽을 때 권한 확인이 뜰 수 있음
- Codex·Grok에는 해당 없음 (Claude Code 훅)

## 테스트
- `scripts/test-compress-hook.js` 48 (명령 선별, 결과 형태 유지, 실패 줄 보존, fail-open 4종, 프로세스 stdin/stdout)
- `test:aor` 15 (설정 파일, 환경변수, 래퍼 인자, 서브커맨드 제외, 사용자 --settings 우선, CLI 버튼 1회, 설정 OFF)

## Codex 리뷰 경과 (task-016·017 합동)
| 회차 | 판정 | 핵심 |
|---|---|---|
| r1 | ⚠️ Major 4 | macOS에서 PowerShell 엔진 실행 시도 → Windows 전용, Node importer 캐시 절감 잔존, 훅 설정 파일 재검증·임시 파일, `--settings=`·옵션 뒤 서브커맨드 |
| r2 | ⚠️ Major 1 | raw 로그 없이 요약만 오면 원본 유실 → `raw:` 파일 확인, 임시 파일 0600 |
| r3 | ⚠️ Major 1 | 존재만 하는 raw 파일 신뢰 → 엔진 raw 폴더 직속 + sha256 일치할 때만 |
| r4 | ⚠️ Major 1 | PostToolUse 전환 때 watch 필터 누락 → 복구(`--watch`·`-w`·`--looponfail`·`:watch` 등), 대시보드 전후 합계 |
| r5 | ✅ 승인 | 신규 이슈 없음 |

## 최종 테스트
- unit 212 · hook 67 · aor 22(실제 엔진·가짜 claude) · smoke 50 · resume 27 · browser 64
