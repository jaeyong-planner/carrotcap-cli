# Changelog

## 0.2.1 — 2026-09-27

### 터미널 UI 테마 (task-020)
- GitHub Dark 계열 팔레트를 토큰으로(배경 #0D1117·패널 #161B22·테두리 #30363D), 강조는 Cyan 하나, 상태색 Green/Yellow/Red 고정
- 터미널 ANSI 16색을 같은 팔레트로, 폰트 JetBrains Mono → Cascadia Code → Fira Code → IBM Plex Mono → SF Mono (기존 기본값만 자동 전환)

### 콘솔 에러 → 채팅 첨부 (task-019)
- "새 콘솔 에러를 채팅에 첨부" 체크박스 → 버튼. 누르면 입력창 위에 읽기 전용 첨부 칩(개수·미리보기·✕)으로 들어가고, 보낼 때 에이전트 페인에만 보호 경로로 전달
- 페이지 문자열은 편집 입력칸·기록·클립보드에 들어가지 않음, 페이지 이동·브라우저 닫기 시 첨부 자동 해제

### `carrotcap` 명령 · 원클릭 설치 (task-018)
- 설치 파일(`CARROTCAP-CLI-Setup-<ver>.exe`)을 더블클릭하면 바로 설치·실행(사용자 단위, 관리자 권한 불필요, 바탕화면·시작 메뉴 바로가기)
- 터미널에서 `carrotcap` → CARROTCAP CLI (cmd·PowerShell 5.1/7: `WindowsAppscarrotcap.bat`, Git Bash: 확장자 없는 실행기). Cream CLI의 `carrotcap.cmd`보다 우선(PATHEXT 순서)
- **appId를 `com.carrotcap.carrotcap-cli`로 분리** — 이전 appId가 Cream CLI와 같아 설치 시 Cream이 제거되던 문제(2026-09-27 사고) 해결
- 설치 폴더 전용화(`Programscarrotcap-cli`), 다른 제품 등록·폴더 밖 경로·junction이 있으면 설치/제거 중단, 실행기는 표시(marker)로 소유권 확인
- 사용자 PATH를 더 이상 수정하지 않음, 복구 스크립트 `resourcesepair-cli.ps1` 포함

### AOR 엔진 연결 (task-016)
- Cream CLI 0.3.2 엔진 스크립트를 번들 — AOR/AIOps 페인이 실제로 엔진 셸로 부팅
- 대시보드 정직화: Claude 프롬프트 캐시 읽기를 "절감"으로 세던 계산 분리 (기존 3.26억 → 실제 압축 절감 약 3.5만)
- 콘솔 셔임 기본 OFF(`aor.consoleShims`) — dev 서버 출력이 막히던 문제 방지
- 엔진 raw 로그·리포트·metrics 자동 정리

### 실제 토큰 절감 — Claude 출력 압축 훅 (task-017)
- CARROTCAP에서 띄운 claude에만 PostToolUse 훅: 성공한 테스트·빌드·설치 명령의 긴 출력을 AOR 엔진 요약으로 교체 (실측 17KB→0.8KB), 실패/에러 줄은 원문 보존
- 권한 규칙·명령 실행은 그대로, 실패한 명령 출력은 압축하지 않음, `aor.compressHook`으로 끔

## 0.2.0 — 2026-09-26

CARROTCAP CLI를 Cream CLI와 별개 제품 라인으로 유지하며 진행한 첫 개선 릴리스.

### 브라우저 모드 (task-015)
- 가운데 브라우저 + 오른쪽 에이전트 터미널, PC/모바일(390×844) 전환
- 요소 클릭 주석(번호 핀) + 콘솔/네트워크 에러 수집 → 입력창 전송 시 [브라우저 컨텍스트]와 핀이 그려진 캡처를 에이전트에 함께 전달
- 격리: 별도 메모리 세션·sandbox·http(s)만(리디렉트 포함)·권한/다운로드 거부. 페이지 문자열은 제어문자 제거 후 에이전트 페인에만 전달. 캡처는 앱 데이터 폴더에 최근 20장·3일

### 입력 안정화 추가
- 새 페인을 연 직후 약 2초 동안 입력이 사라지던 문제 수정 (셸 준비 전 입력을 보관 후 전달)
- AIOps 모드 기본 ON, AOR 엔진이 없으면 경고·배지 숨김

### 입력·복사 (task-010, task-011)
- **`Ctrl+W`/`Ctrl+T`를 앱이 가로채 셸을 죽이던 버그 수정** — 앱 단축키는 `Ctrl+Shift+T/W`, 분할 `Alt+Shift+화살표`
- **AOR 폴백 경고를 xterm에 직접 쓰던 문제 제거** — ConPTY 커서가 어긋나 화면이 깨지고 입력이 헛돌던 주원인. 경고는 페인 헤더에 표시
- 입력창 추가: `Ctrl+A` 전체 선택·`Delete`, 한글 조합, `Enter` 보내기, `Shift+Enter` 줄바꿈, 기록, `Ctrl+Shift+Space`
- 사이드바 버튼을 누른 뒤 타이핑하면 입력창으로 (한글 IME 포함)
- 드래그 즉시 복사, 선택 후 `Ctrl+C` 복사(타이핑하면 선택 해제 → 다음 `Ctrl+C`는 중단), 우클릭 *보이는 화면/전체 출력 복사*

### CLI 구성 (task-012)
- Gemini·Antigravity 제거, **Grok 추가 (이미지·영상)** — 역할: Claude=코딩, Codex=리뷰, Grok=미디어
- 기존 설정 자동 마이그레이션(1회), `agents/media.md`, `scripts/run-media.ps1`, MEDIA 버튼
- START/REVIEW 버튼이 PowerShell `<` 미지원으로 실행되지 않던 버그 수정
- 설치되지 않은 CLI 버튼 표시

### 세션 이어하기 (task-013)
- 프로젝트별 탭/페인 배치와 CLI를 기억해 다음 실행(비정상 종료 포함)에 **이어하기** 제안 → 각 CLI의 이어하기 옵션으로 복원
- 정상 종료 시 최신 세션만 배치 유지·최대 5개, 30일 지난/사라진 프로젝트 기록 자동 삭제, 에이전트 원본 로그는 성공 시 삭제

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
