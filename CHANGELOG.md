# Changelog

## 0.2.0 — 2026-09-26

CARROTCAP CLI를 Cream CLI와 별개 제품 라인으로 유지하며 진행한 첫 개선 릴리스.

### 보안 (task-007)
- 렌더러 `sandbox: true`, webview 비활성, 앱 내 이동·새 창 차단 (http(s) 링크만 외부 브라우저)
- 모든 IPC가 메인 창의 최상위 프레임에만 응답
- `pty:spawn` 입력 화이트리스트 — 작업 폴더(cwd)는 사용자가 고른 폴더 안만 허용
- `pty:write/resize/kill` id·타입·크기 검증 (null 입력으로 메인 프로세스가 죽던 문제 제거)
- CLAUDE.md 저장: 텍스트만, 512KB 이하, 실패 사유 표시
- `index.html` CSP 추가

### 변경 (task-008)
- 설정·CLAUDE.md·허용 폴더 목록을 `%APPDATA%\carrotcap-cli`(개발: `carrotcap-cli-dev`)에 저장
  - 설치본에서 `app.asar` 안에 쓰려다 조용히 실패하던 문제 해결
  - 첫 실행 때 번들 기본값을 복사, 이후 덮어쓰지 않음
  - 읽을 수 없는 `settings.json`은 `settings.json.corrupt-<시각>`으로 보존한 뒤 기본값으로 다시 만듦

### 추가 (task-009)
- 터미널 복사/붙여넣기: `Ctrl+C`(선택 시) · `Ctrl+Shift+C` · `Ctrl+Shift+V` · `Shift+Insert`, 우클릭 메뉴
- AIOps SETUP 문서를 `templates/aiops/`로 분리 — 편집 가능. 템플릿이 하나라도 없으면 아무것도 쓰지 않고 누락 파일명을 알려줌

### 개발 환경 (task-006)
- git 저장소 도입 (`main` = v0.1.0 기준점)
- `scripts/setup-dev.ps1`: node_modules를 Google Drive 밖에 설치하고 junction으로 연결
- `npm test`, `npm run test:smoke`

## 0.1.0 — 2026-05-06
- 첫 버전: 탭·분할 터미널, 폴더 사이드바, CLAUDE/GEMINI/CODEX 원클릭, AOR 모드, AIOps 3-Agent 워크플로우
