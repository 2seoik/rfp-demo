#!/bin/bash
set -e

# ─── Colors ────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}  RFP Demo - 서버 + Worker 실행${NC}"
echo -e "${CYAN}============================================================${NC}"

# ─── 이전 프로세스 정리 ─────────────────────
echo -e "${YELLOW}🔧 이전 프로세스 정리 중...${NC}"

# 1. Next.js 포트 3000 정리
if command -v lsof &>/dev/null; then
  if lsof -ti :3000 &>/dev/null 2>&1; then
    OLD_PID=$(lsof -ti :3000)
    echo -e "   → 포트 3000 사용 중 (PID: $OLD_PID), 종료 중..."
    kill -9 $OLD_PID 2>/dev/null || true
    sleep 1
  fi
fi

# 2. 기존 Worker 프로세스 정리
OLD_WORKER=$(ps aux | grep "scripts/worker.ts" | grep -v grep | awk '{print $2}' 2>/dev/null || echo "")
if [ -n "$OLD_WORKER" ]; then
  echo -e "   → 기존 Worker (PID: $OLD_WORKER) 종료 중..."
  kill -9 $OLD_WORKER 2>/dev/null || true
  sleep 1
fi

echo -e "${GREEN}✅ 정리 완료${NC}"

# ─── 로그 디렉토리 ─────────────────────────
mkdir -p "$PROJECT_DIR/logs"

# ─── Next.js 서버 시작 (백그라운드) ────────
echo -e ""
echo -e "${YELLOW}🚀 Next.js 서버 시작 중...${NC}"
pnpm dev > "$PROJECT_DIR/logs/next.log" 2>&1 &
NEXT_PID=$!
echo -e "   → PID: $NEXT_PID (로그: logs/next.log)"

# Next.js 서버가 뜰 때까지 대기
sleep 3
for i in {1..15}; do
  if curl -s -o /dev/null -w "" http://localhost:3000/ 2>/dev/null; then
    echo -e "${GREEN}✅ Next.js 서버 실행 중: http://localhost:3000${NC}"
    break
  fi
  if [ $i -eq 15 ]; then
    echo -e "${RED}❌ Next.js 서버 시작 실패 (logs/next.log 확인)${NC}"
    cat "$PROJECT_DIR/logs/next.log" | tail -30
    exit 1
  fi
  sleep 1
done

# ─── Worker 시작 (같은 터미널, 포그라운드) ──
echo -e ""
echo -e "${YELLOW}🧑‍🏭 Worker 시작 중...${NC}"
echo -e ""
echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}  🟢 실행 중${NC}"
echo -e "${CYAN}  - Next.js: http://localhost:3000${NC}"
echo -e "${CYAN}  - Worker 로그: 아래에 실시간 출력${NC}"
echo -e "${CYAN}  - 종료: Ctrl+C${NC}"
echo -e "${CYAN}============================================================${NC}"
echo -e ""

# 종료 시그널 핸들러
cleanup() {
  echo -e ""
  echo -e "${YELLOW}🛑 종료 중...${NC}"
  kill $NEXT_PID 2>/dev/null || true
  echo -e "${GREEN}✅ 종료 완료${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM

# Worker 실행 (포그라운드 — 로그가 이 터미널에 바로 출력됨)
pnpm worker

# (Worker가 종료되면 여기 도달)
cleanup
