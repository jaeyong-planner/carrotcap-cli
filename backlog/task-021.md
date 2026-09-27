# task-021 — JetBrains Mono를 앱에 포함해 배포

## 요청
사용자 PC에 설치하지 않아도 JetBrains Mono로 보이게, 폰트 파일을 앱에 넣어 배포 (Italic 포함).

## 출처·라이선스
- JetBrains 공식 릴리스 `JetBrainsMono-2.304.zip` (github.com/JetBrains/JetBrainsMono/releases, 5,622,857 B, sha256 `6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf`) — 사용자 승인 후 다운로드
- 포함: `fonts/webfonts/JetBrainsMono-{Regular,Bold,Italic,BoldItalic}.woff2` (약 380KB) + `OFL.txt` → `fonts/jetbrains-mono/`. zip은 삭제
- SIL Open Font License 1.1: 앱에 번들·재배포 허용, 라이선스 동봉 필요(동봉함), 폰트 단독 판매 금지

## 변경
- `styles.css`: `@font-face` 4종(`font-display: block`), 이름 `JetBrains Mono` — 설치 여부와 무관
- `renderer.js`: 부팅 시 Regular·Bold를 먼저 로드(최대 1.5초) 후 터미널 생성 — xterm이 열릴 때 글자 폭을 재므로
- `package.json`: `fonts/**/*` 포함 (asar 안에서 로드 확인)

## 테스트
- smoke 53 (+3: 4종 선언, Regular·Bold 로드, 터미널 첫 폰트가 JetBrains Mono)
- 패키지 앱: Regular·Bold `loaded`, Italic은 쓸 때 로드
- 스크린샷: 0/O, 1/l/I 구분 확인
- unit 232, browser 94, resume 27
