# task-006 — v0.2.0 기반 정리 (git · node_modules · 문서)

## 상태
- 생성일: 2026-09-26
- PM: Claude Code
- 우선순위: P0 (이후 모든 작업의 롤백 지점)
- 상태: 완료

## 목적
CARROTCAP CLI를 Cream CLI(별도 제품, v0.3.2)와 분리된 독립 라인으로 유지하며 v0.2.0으로 개선한다.
그 첫 단계로 되돌릴 수 있는 이력과 재현 가능한 개발 환경을 만든다.

## 범위
- [x] `git init` → `main`에 v0.1.0 baseline 커밋, 작업은 `feature/v0.2.0` 브랜치
- [x] `.gitignore` 보강: `workspace-state.json`, `AOR/.engine.lock`, `AOR/engine/**/bin/`(85MB), `logs/**/_prompt_*.txt`
- [x] `node_modules`를 Drive 밖(`%USERPROFILE%\.carrotcap-dev\carrotcap-cli`)에 `npm ci`로 재설치 + junction 연결
- [x] 재현 스크립트 `scripts/setup-dev.ps1`
- [x] README: 설치 경로/프리빌트 PTY 설명/빌드·테스트 표/디렉터리 구조/AOR 탐색 순서 현행화
- [x] `npm test` 스크립트 추가

## 비범위
- 코드 동작 변경 (task-007 이후)

## 검증 기준
1. `git log` 에 baseline 커밋 존재, 현재 브랜치 `feature/v0.2.0`
2. `node_modules` 가 Junction 이며 `npm run prebuild-check` 통과
3. `npm test` 통과

## 참고
- Drive for desktop이 junction 대상을 따라가 동기화하는지는 미검증. 동기화 트래픽이 계속 보이면 소스 자체를 Drive 밖으로 옮기는 것을 검토.
