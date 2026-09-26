# task-004 — workspace 경계 검증 (Critical #4, #5, #6, #9)

## 상태
- 생성일: 2026-05-06
- PM: Claude Code
- 상위 입력: `logs/review/task-002_main-preload-security.md`
- 우선순위: P0 (Path Traversal 가능)
- 모드: 오토 승인 (Codex 반영 자동)

## 목적
임의 경로로 호출되는 4개 IPC를 **명시적으로 허가된 workspace 안**으로만 제한한다.

| 등급 | 위치 | 이슈 |
|------|------|------|
| Critical #4 | `folder:tree` (main.js: ipcMain handle) | rootPath 무검증 — 임의 디렉터리 트리 노출 |
| Critical #5 | `folder:search` | rootPath/query 무검증 — 임의 디렉터리 검색 |
| Critical #6 | `folder:open-in-os` (shell.showItemInFolder) | 경로 무검증 — 임의 파일 OS 노출 |
| Critical #9 | `aiops:setup` | projectRoot 무검증 — 임의 위치에 `agents/`, `logs/`, `backlog/`, `CLAUDE.md` 생성 |

## 비범위
- Critical #7, #8 (pty:*) → task-005
- Critical #1 (sandbox) → task-006

## 구현 설계

### A. allowedWorkspaces 모델
- 모듈 레벨 `Set<string>` (canonical realpath만 저장)
- 채워지는 경로:
  1. 앱 부팅: `settings.defaultProjectPath`가 존재하면 추가
  2. 앱 부팅: `settings.recentWorkspaces[]`의 각 항목이 존재하면 추가
  3. `folder:pick` 성공 시: 선택된 경로 + 가장 최근으로 `recentWorkspaces`에 push

### B. 헬퍼
- `safeRealpath(p)` — `fs.realpathSync.native` 실패 시 `path.resolve` fallback
- `isPathInsideRoot(target, root)` — 두 쪽 모두 realpath 후 prefix 비교 (Windows는 case-insensitive)
- `isPathInsideAllowedWorkspace(target)` — 타입/제어문자 체크 + Set 순회
- `addAllowedWorkspace(p)` — realpath + isDirectory 검증 + Set 등록
- `persistRecentWorkspace(real)` — 가장 최근으로 이동, dedupe, cap 16

### C. validateSettings 확장
- `recentWorkspaces: string[]` (≤16, 각 ≤1024) 화이트리스트 추가
- 기존 settings round-trip이 이 필드를 잃지 않도록

### D. IPC 핸들러 보강
- `folder:pick` — 성공 시 addAllowedWorkspace + persistRecentWorkspace
- `folder:tree(rootPath)` — `isPathInsideAllowedWorkspace` 거부 시 null
- `folder:search(rootPath, query)` — 위와 동일 + query는 string ≤256
- `folder:open-in-os(p)` — 위와 동일 + 존재 검증 후 shell.showItemInFolder
- `aiops:setup(projectRoot)` — projectRoot가 allowlist 안에 없으면 `{ ok:false, error: '먼저 폴더를 선택하세요' }`

### E. 디렉터리 스캐너 강화 (defense in depth)
- `buildFolderTree` / `searchFiles`에서 `entry.isSymbolicLink()` 스킵 (workspace 외부로의 escape 방지)

## 검증 기준
1. `folder:tree('C:\\Windows')`가 allowlist 외부 경로 거부 (null 반환)
2. `folder:search('C:\\','x')` 거부
3. `folder:open-in-os('C:\\Windows\\System32\\cmd.exe')` 거부
4. `aiops:setup('C:\\Users\\Public\\anywhere')` 거부 (allowlist 없음)
5. 정상 워크플로우: `folder:pick` → 선택 폴더 → `folder:tree(picked)` 정상 반환
6. allowlist 폴더 내부 symlink가 외부 가리킬 때 트리/검색에서 스킵
7. `recentWorkspaces`가 settings:set round-trip 후 보존
8. Codex 재리뷰: 4건 RESOLVED, 신규 Critical/Major 없음

## 다음 단계
- 구현 → 헬퍼로 Codex 리뷰 → 자동 반영 → smoke test 통과 시 task-005 진행
