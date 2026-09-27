# task-012 — CLI 재구성: Gemini/Antigravity 제거, Grok(이미지·영상) 추가

## 상태
- 생성일: 2026-09-26
- 요청: "grok 선택을 추가하고 안티그래비티 구글 cli는 삭제, grok은 이미지와 영상을 요청에 따라 제작, 코덱스는 코드리뷰, 클로드는 코딩"
- 우선순위: P1

## 조사
- Grok Build CLI 1.0.30 설치됨 (`%USERPROFILE%\.grok\bin\grok`, 사용자 PATH 포함). **로그인 안 됨** → 사용자가 `grok login` 필요
- 미디어 기능: `/imagine <설명>`(이미지), `/imagine-video <설명>`(샷 계획 → 이미지 → image_to_video), headless `grok -p` / `--prompt-file`, `--cwd`
- 기존 사용자 설정(`%APPDATA%\carrotcap-cli\settings.json`)에 `cli.gemini.command = "agy"`(Antigravity)가 있음

## 역할
| CLI | 역할 | 규약 | 산출물 |
|---|---|---|---|
| claude | PM · 코딩 · 조사 | templates/aiops/supervisor.md | 코드, backlog |
| codex | 코드 리뷰 | agents/reviewer.md | logs/review/ |
| grok | 이미지·영상 (요청 시) | agents/media.md | assets/generated/, logs/media/ |

## 구현
- QUICK CLI: CLAUDE / CODEX / GROK, AI DEV FLOW: SETUP / START / REVIEW / MEDIA
- 설정 마이그레이션 `migrateSettings` (settingsVersion 2, 1회만): 키 또는 명령이 gemini·antigravity·agy인 항목 삭제, grok 추가. 사용자가 이후 grok을 지워도 다시 넣지 않음
- 삭제: `agents/researcher.md`, `scripts/run-researcher.ps1` / 추가: `agents/media.md`, `scripts/run-media.ps1` (headless, `--prompt-file` 경유 — PS 5.1 네이티브 인자 따옴표 문제 회피)
- AIOps SETUP: `logs/research` 대신 `logs/media`, media.md·run-media.ps1 배포, 템플릿 역할 문구 갱신
- **추천 보강 (버그)**: START/REVIEW 버튼이 `claude < agents\supervisor.md` 형태였는데 PowerShell은 `<` 리디렉션을 지원하지 않아 **실행 자체가 실패**했다 → `& 'claude' '<첫 프롬프트>'`로 규약 파일을 읽게 함. CLI 인자는 모두 PowerShell 단일따옴표로 인용
- **추천 보강**: `cli:status` IPC — `where.exe`로 설치 여부 확인(30초 캐시), 미설치 버튼은 흐리게+취소선, 클릭 시 안내
- CLAUDE.md §7, README 갱신

## 검증
- `npm test` 128/128 — 마이그레이션(agy/antigravity/명령명 기준 삭제, grok 추가, 1회성, 입력 불변), 번들 settings 검증
- `npm run test:smoke` 46/46 — 버튼 구성, cli:status, 시드 설정에 gemini 없음
- 실제 PowerShell에서 `& 'node' '-p' 'process.argv[1]' '<한글 프롬프트>'` → 한글 인자 손상 없이 전달 확인

## 한계
- Grok 이미지/영상 생성은 로그인 전이라 실제 생성은 미검증. 저장 위치는 규약(agents/media.md)으로 지시하며 Grok이 따르는지는 첫 사용 때 확인 필요

## 리뷰 반영 — backlog/task-013.md "리뷰 반영 r1" 참조 (스크립트 경로 검증·exit code·settingsVersion 정수 비교)
