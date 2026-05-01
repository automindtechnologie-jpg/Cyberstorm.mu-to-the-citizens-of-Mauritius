#!/bin/bash
# ═══════════════════════════════════════════════════════
#  Cyberstorm.mu Petition Platform — Deploy Script
#  Usage: ./scripts/deploy.sh
#  Requires: Docker, Docker Compose v2, Traefik running
# ═══════════════════════════════════════════════════════

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}"
echo "═══════════════════════════════════════════════════════"
echo "  Cyberstorm.mu — Petition Platform Deployment"
echo "═══════════════════════════════════════════════════════"
echo -e "${NC}"

# ── 1. Check requirements ──────────────────────────────
echo -e "${CYAN}[1/6] Checking requirements...${NC}"

if ! command -v docker &> /dev/null; then
  echo -e "${RED}✗ Docker not found. Install it: https://docs.docker.com/engine/install/${NC}"
  exit 1
fi

if ! docker compose version &> /dev/null; then
  echo -e "${RED}✗ Docker Compose v2 not found.${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Docker $(docker --version | awk '{print $3}' | tr -d ',')"
echo -e "✓ Docker Compose $(docker compose version --short)${NC}"

# ── 2. Check .env ──────────────────────────────────────
echo -e "\n${CYAN}[2/6] Checking .env file...${NC}"

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo -e "${YELLOW}⚠ .env not found. Copying from .env.example...${NC}"
    cp .env.example .env
    echo -e "${RED}⚠ IMPORTANT: Edit .env with your own values before continuing!${NC}"
    echo -e "  nano .env"
    echo ""
    read -p "Press ENTER when .env is ready, or Ctrl+C to cancel..."
  else
    echo -e "${RED}✗ .env file not found. Create it from .env.example${NC}"
    exit 1
  fi
fi

# Check for placeholder values
if grep -q "CHANGE_ME" .env; then
  echo -e "${RED}✗ .env still contains placeholder values (CHANGE_ME). Please edit it first.${NC}"
  echo -e "  nano .env"
  exit 1
fi

echo -e "${GREEN}✓ .env configured${NC}"

# ── 3. Check network ───────────────────────────────────
echo -e "\n${CYAN}[3/6] Checking Docker network...${NC}"

if ! docker network ls | grep -q "root_default"; then
  echo -e "${YELLOW}⚠ Network 'root_default' not found. Creating...${NC}"
  docker network create root_default
fi
echo -e "${GREEN}✓ Network root_default ready${NC}"

# ── 4. Create data directory ───────────────────────────
echo -e "\n${CYAN}[4/6] Creating data directory...${NC}"
mkdir -p ./data
echo -e "${GREEN}✓ ./data directory ready (SQLite will be stored here)${NC}"

# ── 5. Build image ─────────────────────────────────────
echo -e "\n${CYAN}[5/6] Building Docker image...${NC}"
docker compose build --no-cache
echo -e "${GREEN}✓ Image built${NC}"

# ── 6. Start container ─────────────────────────────────
echo -e "\n${CYAN}[6/6] Starting container...${NC}"
docker compose up -d --force-recreate

# Wait for startup
sleep 3

# Health check
if docker ps | grep -q "cyberstorm-petition"; then
  HEALTH=$(curl -s http://localhost:3000/health 2>/dev/null || echo "pending")
  echo -e "${GREEN}✓ Container running${NC}"
  echo -e "${GREEN}✓ Health: ${HEALTH}${NC}"
else
  echo -e "${RED}✗ Container failed to start. Check logs:${NC}"
  docker logs cyberstorm-petition --tail 30
  exit 1
fi

# ── Summary ────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════"
echo "  ✅ DEPLOYMENT COMPLETE"
echo "═══════════════════════════════════════════════════════${NC}"
echo ""
echo "  Container:  $(docker ps --filter name=cyberstorm-petition --format '{{.Status}}')"
echo ""

# Read token from .env
PETITION_TOKEN=$(grep PETITION_TOKEN .env | cut -d= -f2)
echo "  PETITION FORM (share this link):"
echo "  → Check your domain config in docker-compose.yml"
echo "    URL will be: https://YOUR-PETITION-DOMAIN/?t=${PETITION_TOKEN}"
echo ""
echo "  DASHBOARD:"
echo "  → https://YOUR-DASHBOARD-DOMAIN/dashboard"
DASHBOARD_PASSWORD=$(grep DASHBOARD_PASSWORD .env | cut -d= -f2)
echo "    Password: ${DASHBOARD_PASSWORD}"
echo ""
echo -e "  Logs: ${CYAN}docker logs cyberstorm-petition --tail 30${NC}"
echo -e "  Stop: ${CYAN}docker compose down${NC}"
echo ""
