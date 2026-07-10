#!/bin/bash
set -e

# ─── Colors ────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}  RFP Demo - Seed 데이터 생성${NC}"
echo -e "${CYAN}============================================================${NC}"

# ─── 1. .env 파일 확인 ──────────────────────
if [ ! -f ".env" ]; then
  echo -e "${RED}❌ .env 파일이 없습니다. .env.example을 참고해 생성해주세요.${NC}"
  exit 1
fi
echo -e "${GREEN}✅ .env 파일 확인${NC}"

# ─── 2. Docker PostgreSQL 확인 ──────────────
if ! docker ps --filter "name=rfp-demo-db" --format "{{.Names}}" | grep -q "rfp-demo-db"; then
  echo -e "${YELLOW}⚠️  Docker 컨테이너(rfp-demo-db)가 실행중이 아닙니다.${NC}"
  echo -e "${YELLOW}   'docker compose up -d' 로 DB를 먼저 실행해주세요.${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Docker PostgreSQL 실행 확인${NC}"

# ─── 3. Organization & Project 생성 ──────────
echo -e "\n${YELLOW}📋 Organization/Project 확인 중...${NC}"

ORG_EXISTS=$(docker exec rfp-demo-db psql -U rfpuser -d rfp-demo -t -A -c "SELECT COUNT(*) FROM organizations;")
if [ "$ORG_EXISTS" = "0" ]; then
  echo -e "${YELLOW}   → Organization이 없습니다. 생성합니다...${NC}"
  docker exec rfp-demo-db psql -U rfpuser -d rfp-demo -c "
    INSERT INTO organizations (name, plan) VALUES ('테스트 기관', 'free');
  " > /dev/null
  echo -e "${GREEN}   ✅ Organization 생성 완료${NC}"
else
  echo -e "${GREEN}   ✅ Organization 이미 존재${NC}"
fi

PROJ_EXISTS=$(docker exec rfp-demo-db psql -U rfpuser -d rfp-demo -t -A -c "SELECT COUNT(*) FROM projects;")
if [ "$PROJ_EXISTS" = "0" ]; then
  echo -e "${YELLOW}   → Project가 없습니다. 생성합니다...${NC}"
  docker exec rfp-demo-db psql -U rfpuser -d rfp-demo -c "
    INSERT INTO projects (org_id, name, status)
    VALUES ((SELECT id FROM organizations LIMIT 1), 'RFP 분석 프로젝트', 'draft');
  " > /dev/null
  echo -e "${GREEN}   ✅ Project 생성 완료${NC}"
else
  echo -e "${GREEN}   ✅ Project 이미 존재${NC}"
fi

# ─── 4. RFP PDF 파일 확인 ──────────────────
echo -e "\n${YELLOW}📋 RFP PDF 파일 확인 중...${NC}"
RFP_DIR="docs/rfp"
PDFS=("한국기술대_전자결재_시스템고도화.pdf" "한국폴리텍_전자결재시스템고도화.pdf")
MISSING=0
for pdf in "${PDFS[@]}"; do
  if [ -f "$RFP_DIR/$pdf" ]; then
    echo -e "${GREEN}   ✅ $pdf${NC}"
  else
    echo -e "${RED}   ❌ $pdf (없음)${NC}"
    MISSING=1
  fi
done

if [ "$MISSING" -eq 1 ]; then
  echo -e "${YELLOW}⚠️  일부 PDF 파일이 없습니다. docs/rfp/ 디렉토리를 확인해주세요.${NC}"
fi

# ─── 5. Seed 실행 ──────────────────────────
echo -e "\n${CYAN}============================================================${NC}"
echo -e "${CYAN}  🚀 seed-full.ts 실행 중...${NC}"
echo -e "${CYAN}============================================================${NC}"

pnpm tsx scripts/seed-full.ts

EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "\n${GREEN}============================================================${NC}"
  echo -e "${GREEN}  ✅ Seed 데이터 생성 완료!${NC}"
  echo -e "${GREEN}============================================================${NC}"
else
  echo -e "\n${RED}============================================================${NC}"
  echo -e "${RED}  ❌ Seed 실패 (exit code: $EXIT_CODE)${NC}"
  echo -e "${RED}============================================================${NC}"
  exit $EXIT_CODE
fi
