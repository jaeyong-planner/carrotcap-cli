# task-029 — 앱 아이콘 추가 (기본 Electron 아이콘으로 나가던 문제)

## 요청 (2026-09-28)
"아이콘도 추가해줘" → 이모지 말고 "타이포그래피로".

## 조사 (근거)
- 0.2.4 빌드 로그에 `default Electron icon is used  reason=application icon is not set` — `directories.buildResources`가 `build`인데 그 안에 `icon.ico`가 없었음
- 레포 전체 히스토리에 `.ico`·`.png`·`.icns`가 **한 번도 커밋된 적 없음**(`git log --all --diff-filter=A`). 0.2.3 설치본에도 아이콘 파일이 없고, 0.2.3 `carrotcap.exe`와 0.2.4 빌드 exe의 크기가 172,675,584 B로 **동일** → 이전 버전도 줄곧 기본 Electron 아이콘이었음. 즉 회귀가 아니라 처음부터 없던 것
- 디스크에 쓸 만한 기존 자산은 `COS CLI`의 `cream-cli.ico`뿐 — 다른 제품 브랜드라 사용하지 않음

## 변경
- `build/icon.ico` (16·24·32·48·64·128·256), `build/icon.png` (1024, electron-builder가 mac·linux 아이콘을 파생)
- 마크: 대문자 `C` 한 글자. 서체는 **앱이 번들한 JetBrains Mono Bold**(`fonts/jetbrains-mono/JetBrainsMono-Bold.woff2`를 fontTools로 ttf 변환해 렌더) — UI와 같은 서체
- 색은 `styles.css`에서 그대로: 글자 `#FF8C42`(액센트), 바탕 `#0D1117`, 테두리 `#21262D`. 모서리 둥근 정사각형
- `build.win.icon` 설정은 넣지 않았다 — electron-builder가 `buildResources`의 `icon.ico`를 자동으로 집는다

## 검토한 대안
`>_`(터미널 프롬프트) · `CC`(이니셜) · `C`+블록 커서를 함께 렌더해 16·24·32·48px 실물 크기로 비교. 작업표시줄·시작 메뉴에서 실제로 보이는 크기가 16~32px인데, `>_`는 16px에서 뭉개지고 `CC`는 두 글자가 붙으며 커서 변형은 점 하나가 남아 지저분해짐. 한 글자 `C`가 가장 또렷해서 채택.

## 테스트
- ICO에 7개 크기가 모두 들어갔는지 확인(`Image.ico.sizes()`)
- 빌드 로그에서 `application icon is not set` 경고가 사라지는지 확인
- 설치 후 작업표시줄·시작 메뉴·바탕화면 바로가기 아이콘 확인

## 추가 — exe에 아이콘이 안 박히던 문제
`build/icon.ico`만 넣었더니 **설치 프로그램에는 박혔는데 앱 exe에는 안 박혔다**. `build.win.signAndEditExecutable: false` 때문에 electron-builder가 exe를 다시 쓰지 않는다.

`true`로 바꿔 시험해 봤더니 빌드가 실패했다 — winCodeSign 툴체인을 풀 때 macOS 심볼릭 링크를 만들지 못한다:

```
ERROR: Cannot create symbolic link : 클라이언트가 필요한 권한을 가지고 있지 않습니다
  ...winCodeSign\918572379\darwin\10.12\lib\libcrypto.dylib
```

Windows는 개발자 모드나 관리자 권한 없이는 심볼릭 링크를 못 만든다. 즉 이 설정이 `false`인 건 임의의 기본값이 아니라 **이 제약에 대한 회피책**이었다(v0.1.0 베이스라인부터 들어와 있었고 문서화는 안 돼 있었음).

그래서 플래그는 `false`로 두고, 같은 캐시 안에 들어 있는 `rcedit`로 패키징 후에 아이콘을 박는다:
- `scripts/set-exe-icon.js` (새로 만듦) — `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\*\rcedit-x64.exe`를 찾아 실행. **없으면 경고만 남기고 빌드는 계속**한다(앱은 기본 아이콘, 설치 프로그램 아이콘은 영향 없음)
- `dist:win` = `prebuild-check` → `electron-builder --win --dir` → `set-exe-icon` → `electron-builder --win nsis --prepackaged release/win-unpacked`

검증: 앱 exe 7/7, 설치 프로그램 7/7 아이콘 엔트리 확인.

대안으로 Windows 개발자 모드를 켜면 `signAndEditExecutable: true`로 이 단계 없이 처리된다. 다만 빌드하는 모든 PC에서 켜야 해서 채택하지 않았다.
