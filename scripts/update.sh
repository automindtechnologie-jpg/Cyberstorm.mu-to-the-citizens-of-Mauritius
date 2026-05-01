#!/bin/bash
# ═══════════════════════════════════════════════════════
#  Cyberstorm.mu — Update Script
#  Pulls latest code from GitHub and redeploys
#  Usage: ./scripts/update.sh
# ═══════════════════════════════════════════════════════

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}"
echo "═══════════════════════════════════════════════════════"
echo "  Cyberstorm.mu — Update & Redeploy"
echo "═══════════════════════════════════════════════════════"
echo -e "${NC}"

echo -e "${CYAN}[1/4] Pulling latest code from GitHub...${NC}"
git pull origin main
echo -e "${GREEN}✓ Code updated${NC}"

echo -e "\n${CYAN}[2/4] Rebuilding Docker image...${NC}"
docker compose build --no-cache
echo -e "${GREEN}✓ Image rebuilt${NC}"

echo -e "\n${CYAN}[3/4] Restarting container...${NC}"
docker compose up -d --force-recreate
echo -e "${GREEN}✓ Container restarted${NC}"

sleep 3

echo -e "\n${CYAN}[4/4] Verifying...${NC}"
if docker ps | grep -q "cyberstorm-petition"; then
  HEALTH=$(curl -s http://localhost:3000/health 2>/dev/null || echo "starting...")
  echo -e "${GREEN}✓ Running | Health: ${HEALTH}${NC}"
else
  echo -e "${RED}✗ Container not running. Logs:${NC}"
  docker logs cyberstorm-petition --tail 20
  exit 1
fi

echo ""
echo -e "${GREEN}✅ Update complete.${NC}"
echo -e "   Logs: ${CYAN}docker logs cyberstorm-petition --tail 30${NC}"
