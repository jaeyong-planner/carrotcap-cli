# task-010 — 입력 안정화 + 입력창

## 상태
- 생성일: 2026-09-26
- 요청: "텍스트가 가끔 입력이 안되거나 계속 헛돈다", "입력박스 텍스트를 전체 선택해서 삭제 가능하게"
- 우선순위: P0

## 원인 조사 (CDP로 재현)
| 가설 | 결과 |
|---|---|
| 한글 IME 조합 누락 | 재현 안 됨 (xterm에 `한글` 정상 입력) |
| 빠른 타이핑 누락 | 재현 안 됨 |
| **`Ctrl+W`를 앱이 가로챔** | **재현됨** — 창 레벨 keydown이 `Ctrl+W`(셸/Claude Code의 단어 삭제)를 "페인 닫기"로 처리 → 셸이 죽고 새 페인이 뜸. `Ctrl+T`(새 탭)도 동일 |
| 포커스 유실 | 사이드바 버튼·트리 클릭 후 포커스가 body/버튼에 남아 타이핑이 사라짐 |
| `Ctrl+Shift+←/→` 분할 단축키 | PowerShell의 단어 선택 키와 충돌 |

## 구현
- 앱 단축키 이동: 새 탭 `Ctrl+Shift+T`, 페인 닫기 `Ctrl+Shift+W`, 분할 `Alt+Shift+화살표`, 입력창 `Ctrl+Shift+Space` — 캡처 단계에서 처리, key repeat 무시
- 포커스 복구: body/버튼/트리에 포커스가 있을 때 글자를 치면 입력창으로 이동 (스페이스로 버튼 누르기는 예외)
- 입력창(composer): 일반 textarea — `Ctrl+A`/`Delete`/한글 조합이 항상 동작
  - `Enter` 보내기: `term.paste()`(bracketed paste) 후 60ms 뒤 `\r` 별도 전송, `Shift+Enter` 줄바꿈
  - 한글 조합 중 Enter는 조합 확정(`isComposing`)
  - `↑/↓` 입력 기록(메모리 50개, 저장 안 함), `Esc` 터미널로, 지우기 버튼
  - 대상 페인 표시, 보이기/숨기기는 localStorage(개인 편의)

## 검증 (`npm run test:smoke`, 실제 키 이벤트)
- Ctrl+W/Ctrl+T가 페인·탭을 건드리지 않음, Ctrl+Shift+T/W·Alt+Shift+→ 동작
- 입력창 Ctrl+A → Delete 전체 삭제, 한글 IME 조합, Enter 전송 후 터미널 출력 확인, 전송 후 비움
- 버튼 포커스 상태 타이핑 → 입력창으로 들어감
- 결과: 32/32
