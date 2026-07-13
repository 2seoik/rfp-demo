# RFP Demo — 작업 재개 프롬프트

> 새 세션(또는 이어지는 세션)에서 작업을 재개할 때 아래 블록을 그대로 복사해 에이전트에게 전달하세요.
> 이 파일은 작업 도구이므로 `docs/` 관리 규칙 대상이 아닙니다. 작업 완료 후 삭제하거나 그대로 두셔도 됩니다.

---

## 재개용 프롬프트 (복사해서 사용)

```
RFP Demo 프로젝트 작업을 이어서 진행합니다. 먼저 아래를 순서대로 수행해 현재 상태를 파악한 뒤, 나에게 다음 작업 방향을 제안해줘.

1. AGENTS.md 를 읽고 작업 규칙(절대 규칙 15개 + 문서 관리 규칙 7개)을 숙지한다.
2. 현재 브랜치와 작업 디렉터리 상태를 확인한다 (git branch --show-current, git status, git log --oneline -10).
3. docs/agent/rfp-pipeline-spec.md 의 §16(현재 알려진 문제)과 §17(개선 우선순위)을 읽어 ✅/⚠️/🔴 상태로 진행 상황을 파악한다. 이 파일이 단일 진실 공급원(single source of truth)이다.
4. docs/agent/code-review-2026-07-13.md 를 읽어 검토 근거와 우선순위 매트릭스를 확인한다.
5. 브랜치 트리를 확인한다:
   feat/similar-ui-ux (UI/UX + 문서정리 + push)
     └─ fix/p0-hardening (P0 하드닝 4건: 업로드/XSS/삭제트랜잭션/api-test + push)
         └─ feat/ux-improvements (UX U1 정렬/U4 라벨정정/U5 a11y + push) ← 마지막 작업 지점
6. 완료된 작업과 남은 작업을 표로 정리해 보고한 뒤, 다음 진행 후보를 우선순위/노력/사이드이펙트 관점에서 3~4개 제안하고, 어느 것부터 할지 나에게 물어봐.

남은 작업 후보(참고용, 실제 코드 확인 후 정정 가능):
- P0 잔여: 17.5 재분석 시 requirements 비우기 (사용자 응답 손실 사이드이펙트로 별도 설계 필요)
- UX 잔여: U2 매트릭스 필터(§16.18), U6 유사도 점수 설명(§5.1), U7 분석 완료 후 CTA(§5.3)
- P1: 17.8 FK CASCADE, 17.9 dead code 4건 제거, 17.11 env 기본값 통일, 17.12 GIN 인덱스

작업 시 규칙:
- 한 세션에 단계 하나 원칙이지만, 사이드이펙트 없는 작업은 사용자 동의 하에 묶어 커밋 가능.
- 코드 수정 전 반드시 실제 코드를 먼저 확인(문서 가정 금지, AGENTS.md 규칙 1·2).
- 매 단계 tsc --noEmit 로 검증 (운영 코드 오류 0건 유지; 기존 11개 오류는 scripts/ + 미사용 rfp-analysis.ts).
- 커밋/push는 내 명시적 지시가 있을 때만.
- 단계 완료 후 9항목 보고 형식 사용 (AGENTS.md "단계 완료 보고" 참고).
- 단계 완료 후 spec §16/§17 상태(✅/⚠️/🔴)를 갱신한다 (AGENTS.md 문서 관리 규칙 1).
```

---

## 진행할 항목이 이미 정해져 있을 때 (위 프롬프트 끝에 한 줄 추가)

```
[항목 지정] U2 매트릭스 필터 진행해줘.
[항목 지정] 17.9 dead code 제거 진행.
[항목 지정] 17.11 env 기본값 통일 진행.
[브랜치] 새 브랜치 만들고 진행. (현재 feat/ux-improvements에 있음)
[커밋] 작업 끝나면 커밋 + push까지 진행.
```

---

## 현재 진행 상황 요약 (2026-07-13 기준)

### 완료 (push 완료)
- **문서 정리**: 13개 md 삭제 + spec 최신화 + 검토 보고서 추가 (`feat/similar-ui-ux`)
- **P0 하드닝 4건** (`fix/p0-hardening`):
  - 17.1 업로드 MIME+크기+path.basename 검증 ✅
  - 17.2 dangerouslySetInnerHTML sanitizeMarkHtml ✅
  - 17.3 프로젝트 삭제 트랜잭션 + uploads/ 파일 정리 ✅
  - 17.4 /api/test 프로덕션 게이트 ✅
  - 17.6 analyze-status 정렬 — 실제 문제 아님(정정) ✅
- **UX 3건** (`feat/ux-improvements`):
  - U1 매트릭스 헤더 정렬 + aria-sort ✅
  - U4 "취소하고 대시보드로" → "대시보드로 이동" 라벨 정정 ✅
  - U5 DeleteButton a11y (aria-label, ESC, role=dialog, autoFocus) ✅

### 보류/미착수
- **U3 중요도/신뢰도 컬럼**: LLM 모델 변경 후 신뢰 데이터 확보 시 추가 (사용자 결정)
- **17.5 재분석 requirements 비우기**: 사용자 응답 손실 사이드이펙트 → 별도 설계 필요
- **U2 매트릭스 필터** / **U6 유사도 설명** / **U7 분석 완료 CTA**: UX 잔여
- **17.8 FK CASCADE** / **17.9 dead code 제거** / **17.11 env 통일** / **17.12 GIN 인덱스**: P1

### 브랜치 트리
```
main
└─ feat/similar-ui-ux (UI/UX + 문서정리) [push 완료]
   └─ fix/p0-hardening (P0 4건) [push 완료]
      └─ feat/ux-improvements (UX 3건) [push 완료] ← 현재 HEAD
```

### 원격
- `origin: git@github.com:2seoik/rfp-demo.git`
- 위 3개 브랜치 모두 origin에 push 됨. PR 생성 가능.

---

## 환경 참고

- 패키지 매니저: `pnpm`
- 검증 명령: `npx tsc --noEmit` (lint는 `eslint-config-next` 미설치 + flat config 없어 실행 불가 — 기존 환경 문제)
- 테스트: `pnpm test` (vitest) — 관련 테스트 거의 없음
- 운영 DB: 접근 불가 (마이그레이션은 검토만, 적용은 사용자 지시 시)
- LLM: 현재 `minimax-m2.7`(content 미반환 이슈) → `kimi-k2.6` fallback (17분/프로젝트)
