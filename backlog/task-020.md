# task-020 — 터미널 UI 테마: Dark Neutral + Semantic Color + Minimal Accent

## 요청
사용자가 제안한 스타일 적용: GitHub Dark 계열 배경, JetBrains Mono, Cyan 포인트, Green/Yellow/Red 상태색, 최소한의 박스 UI.

## 변경
| 항목 | 내용 |
|---|---|
| 토큰 | `styles.css :root`에 팔레트 — bg `#0D1117`, panel `#161B22`, raised `#21262D`, border `#30363D`, text `#E6EDF3`/`#8B949E`, Cyan `#58A6FF`, Green `#3FB950`, Yellow `#D29922`, Red `#F85149`, Purple `#BC8CFF` (하드코딩 색 30여 개 → 토큰) |
| 색 규칙 | 강조=Cyan 하나(포커스·활성 탭/페인·주요 버튼·보내기), 성공/켜짐=Green, 경고=Yellow, 에러=Red, 경로(폴더 트리·URL)=Cyan, 보조=회색. 주황은 로고와 주석 핀(페이지 오버레이 핀과 같은 색)에만 |
| 터미널 | xterm ANSI 16색을 같은 팔레트로 고정, 커서 Cyan, 선택 반투명 Cyan, lineHeight 1.15 |
| 폰트 | `'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'IBM Plex Mono', 'SF Mono', Consolas, monospace` (터미널·입력창·폴더 트리·URL) |
| 설정 마이그레이션 v4 | 기존 기본값(`Cascadia Code, Consolas, monospace`) 그대로인 경우만 새 폰트 순서로, 사용자가 고른 폰트는 유지 |

## 한계
- 이 PC에는 JetBrains Mono가 설치돼 있지 않아 Cascadia Code로 표시됨 (앱에 번들하지 않음)
- 로그 "계층 구조(Task Tree)"는 각 CLI(claude/codex)가 출력하는 형식이라 앱이 바꾸지 않음 — 앱은 그 출력의 색을 일관되게 보여 줌

## 테스트
- unit 232(+3 v4 마이그레이션), smoke 50, resume 27, browser 94, aor 22
- 스크린샷으로 상태색·기호(◆ ├─ ✓ →) 렌더링 확인
