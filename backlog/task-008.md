# task-008 — 사용자 상태를 userData로 분리

## 상태
- 생성일: 2026-09-26
- PM: Claude Code
- 우선순위: P1
- 참고 구현: Cream CLI 0.3.2 (`USER_DATA_ROOT` + bundled fallback)

## 문제
- `settings.json` / `CLAUDE.md` / `workspace-state.json`을 `__dirname`(코드 폴더)에 썼다.
  - 설치본: `__dirname`이 `app.asar` 내부 → **쓰기 실패** (설정 저장·CLAUDE.md 편집·작업 폴더 허용 목록 저장이 조용히 깨짐)
  - 개발: 렌더러가 폴더 로드 때마다 `settings:set` → git 추적 파일 `settings.json`이 계속 변경됨

## 구현
- `app.setPath('userData', %APPDATA%\carrotcap-cli)` (설치본) / `carrotcap-cli-dev` (개발) — Cream CLI(`cream-cli`)와 분리
- `SETTINGS_PATH`, `CLAUDE_MD_PATH`, `WORKSPACE_STATE_PATH` → userData
- `initUserState()` (부팅 시 1회):
  - settings 없음 → 번들 `settings.json`을 `validateSettings`로 정제해 시드 (실패 시 `buildDefaultSettings()`)
  - CLAUDE.md 없음 → 번들 복사
  - 레거시 `<APP_ROOT>/workspace-state.json` → 1회 마이그레이션
  - 기존 사용자 파일은 절대 덮어쓰지 않음
- `aor:get-claude-md`: userData → 번들 순으로 읽기
- README §9 설정 파일 위치

## 검증
1. `npm test` 통과
2. CDP 스모크: 개발 실행 시 `%APPDATA%\carrotcap-cli-dev\{settings.json, CLAUDE.md}` 생성, 레포 `settings.json` 변경 없음
3. 설치본(`npm run pack`)에서 설정 저장 동작 — task-009 빌드 검증에서 확인

## 알려진 사항
- `%APPDATA%\carrotcap-cli`에는 이전 CARROTCAP 빌드(F5-dev 등)의 설정이 이미 있다. 설치본 v0.2.0은 이 파일을 그대로 이어서 쓴다(덮어쓰지 않음).
