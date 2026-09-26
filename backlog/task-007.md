# task-007 — IPC 보안 마무리 (task-002 잔여 Critical #1, #7, #8 + Major M3, M4)

## 상태
- 생성일: 2026-09-26
- PM: Claude Code
- 상위 입력: `logs/review/task-002_main-preload-security.md`
- 우선순위: P0

## 목적
task-003~005에서 남겨둔 IPC 보안 항목을 닫는다.

| 항목 | 위치 | 조치 |
|------|------|------|
| Critical #1 | `webPreferences.sandbox: false` | `sandbox: true` (+ `webviewTags: false`) |
| Critical #7 | `pty:spawn` payload 무검증 | `sanitizeSpawnPayload` — mode enum, cliKey 정규식/예약어, cols/rows clamp, **cwd는 workspace allowlist 안의 디렉터리만** |
| Critical #8 | `pty:write` 무검증 | id 형식(`PTY_ID_RE`) + data string + 1MB 상한, null payload 크래시 제거 |
| Major M3/M4 | `pty:resize` / `pty:kill` | id 형식 검증, cols/rows clamp |
| 신규 | `aor:set-claude-md` 무검증 | string / NUL 금지 / 512KB 상한, 실패 시 false + 렌더러 alert |
| 신규 | `resolvePtyArgs`의 `settings.defaultProjectPath` 폴백 | allowlist 밖이면 무시 (AIOps 자동 setup이 임의 경로에 쓰지 못하게) |
| 하드닝 | 모든 IPC | `isTrustedSender` — mainWindow의 top-level frame만 응답 |
| 하드닝 | 내비게이션 | `will-navigate` 차단, `setWindowOpenHandler` deny + http(s)만 외부 브라우저 |
| 하드닝 | `index.html` | CSP 메타 (`script-src 'self'`, `connect-src 'none'` 등) |

## 비범위
- AOR 엔진 쪽 스크립트(`shell-init.ps1` 등) 검증
- pty 세션 자체가 셸이므로 "셸 안에서 할 수 있는 일"은 위협 모델 밖

## 검증 기준
1. `npm test` — 신규 helper 테스트 포함 전부 통과
2. CDP 스모크: bridge 존재, `require` 미노출, xterm 렌더, PTY 스폰, hostile IPC(비문자열 CLAUDE.md, 600KB, 잘못된 mode/cwd/cols, 잘못된 pty id, window.open) 모두 거부/무해
3. Codex 리뷰 Critical/Major 0
