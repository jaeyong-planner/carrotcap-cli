# task-005 — AIOps 모드 자동화 통합

## 상태
- 생성일: 2026-05-06
- PM: Claude Code
- 우선순위: P1 (UX + 워크플로우 즉시성)
- 모드: 오토 승인

## 목적
AIOps 토글이 ON 상태일 때, 사용자가 별도로 SETUP 버튼을 누르지 않아도
새 페인을 만들면 자동으로:
1. 워크플로우 구조(agents/logs/backlog/CLAUDE.md)가 생성되고
2. PM(Claude)이 만든 풍부한 `agents/researcher.md` / `agents/reviewer.md`가 배포되고
3. 헬퍼 스크립트 `scripts/run-researcher.ps1` / `scripts/run-reviewer.ps1`이 배포되어
4. 즉시 RESEARCH/REVIEW 버튼이 헬퍼 경유로 동작

## 현재 동작 (변경 전)
- AIOps 토글 ON → 새 페인이 `mode: 'aiops'`로 부팅
- 사용자가 SETUP 버튼 수동 클릭 → `aiops:setup` IPC → `ensureAiopsProjectStructure`
- `ensureAiopsProjectStructure`는 main.js 내부에 임베드된 **간략 버전**의 supervisor/researcher/reviewer.md만 생성
- 헬퍼 스크립트는 복사되지 않음 → RESEARCH/REVIEW 버튼은 `gemini < agents/researcher.md` / `codex < agents/reviewer.md` 직접 호출(헬퍼 우회)

## 변경 후 동작
- AIOps 토글 ON + 폴더 선택 상태에서 새 페인 생성 시 **자동** `setupAiopsWorkflow()` 호출
- `ensureAiopsProjectStructure`가 **carrotcap-cli/agents/researcher.md, reviewer.md 풍부 버전**을 프로젝트로 복사
- 동시에 **carrotcap-cli/scripts/run-researcher.ps1, run-reviewer.ps1**을 프로젝트의 `scripts/`로 복사
- 모든 복사는 task-004의 `assertAncestorsClean` + `writeIfMissing` 가드를 통과

## 비범위
- RESEARCH/REVIEW 버튼이 헬퍼 스크립트를 호출하도록 변경 — task-006에서 별도 처리
- pty:* / sandbox 보안 — task-006 / task-007

## 구현 설계

### A. main.js
1. **APP_ROOT의 템플릿 경로 결정 헬퍼** — 패킹/개발 모드 모두 처리
   - 개발 모드: `<APP_ROOT>/agents/*`, `<APP_ROOT>/scripts/*`
   - 패킹 모드: 빌드 시 `build.files`에 포함되어 asar 내부에서 접근
2. **`copyTemplateIfMissing(sourcePath, destPath, projectRoot)`** 헬퍼:
   - source 파일을 fs.readFileSync로 읽어 destPath에 `writeIfMissing` 호출
   - source 미존재 시 silent skip + warn (개발자에게만 영향)
3. **`ensureAiopsProjectStructure` 확장**:
   - 기존 임베드 supervisor.md는 유지 (PM은 메인 supervisor 역할)
   - researcher.md / reviewer.md는 임베드 버전 대신 carrotcap-cli/agents/*.md 사용 (writeIfMissing이 이미 있는 파일은 안 덮으므로, 이미 있는 프로젝트는 영향 없음)
   - scripts/ 디렉터리 생성 + 헬퍼 두 스크립트 복사

### B. renderer.js
1. `state.aiopsAutoSetupDone: Set<string>` — 이미 setup된 워크스페이스 캐시 (rootPath별)
2. `spawnIntoPane`이 `mode === 'aiops'`로 호출될 때:
   - 폴더 선택돼 있고, 캐시에 없으면 **선** `setupAiopsWorkflow()` 호출, 성공 시 캐시에 추가
   - 폴더 미선택 시 기존 동작 유지(워크스페이스 없이 페인만)
3. 폴더 변경 시 캐시 초기화 (`pickFolder` 안)

### C. package.json
- `build.files`에 추가:
  - `"agents/**/*"`
  - `"scripts/run-researcher.ps1"`
  - `"scripts/run-reviewer.ps1"`
- 보안상 다른 scripts/*.ps1은 패키지에서 제외 유지

## 검증 기준
1. AIOps 토글 ON + 폴더 선택 + 새 페인 생성 → 별도 SETUP 클릭 없이 agents/, logs/, backlog/, scripts/ 모두 생성
2. agents/researcher.md, agents/reviewer.md가 carrotcap-cli/agents/의 풍부한 버전과 동일
3. scripts/run-researcher.ps1, run-reviewer.ps1이 carrotcap-cli/scripts/와 동일
4. **이미 존재하는 파일은 덮어쓰지 않음** (writeIfMissing 보장)
5. 워크스페이스 외부 symlink로 escape 시도 → 거부 (assertAncestorsClean)
6. 같은 페인을 닫고 다시 열어도 setup이 재호출되지 않음 (캐시)
7. Codex 리뷰: 기존 보안 가드를 우회하지 않음 + 신규 Critical/Major 0건

## 다음 단계
구현 → smoke test → Codex r1 → 자동 반영 → ✅ 승인 시 사용자 테스트 권고 (`npm start`로 GUI 동작 확인)
