# Cyberstorm.mu — National Petition Platform

> **Hosted live:** Frankfurt, Germany · Hostinger KVM4 VPS  
> Built and delivered by **Elemental Genesis Agent Labs** — Jean Michel Rey, Mauritius

---

## 🔗 Live Links

| | URL | Access |
|---|---|---|
| **Petition Form** | `https://petition.srv1561000.hstgr.cloud/?t=73UnDjcXFNGyXDbycuOhs0Gb` | Token in URL |
| **Dashboard** | `https://cyberstorm.srv1561000.hstgr.cloud/dashboard` | Password protected |

**Dashboard password:** `NPI6eEWPOiLJK2TyBt4`

> ⚠ The petition link contains a private token (`?t=…`). Anyone without the full URL sees "Access Denied". Share only the complete link.

---

## 📁 Project Structure

```
cyberstorm-petition/
│
├── server.js              # Express + SQLite backend API
├── package.json           # Node.js dependencies
├── Dockerfile             # Docker image definition
├── docker-compose.yml     # Full deployment config (Traefik + volumes)
├── .env.example           # Environment variables template → copy to .env
├── .gitignore
│
├── public/
│   ├── petition.html      # Petition form (full page, responsive)
│   ├── dashboard.html     # Management dashboard (full page)
│   ├── logo.jpeg          # Cyberstorm.mu logo
│   └── video.mp4          # Campaign video
│
├── scripts/
│   ├── deploy.sh          # One-command deploy (requires Docker + Docker Compose)
│   ├── update.sh          # Pull latest + rebuild + restart
│   └── deploy-socket.js   # Deploy via Docker socket only (no CLI needed)
│
└── data/
    └── .gitkeep           # signatures.db is created here at runtime (not in git)
```

---

## 🏗 Architecture

```
Internet
   │
   ▼
Traefik v3.6.1 (reverse proxy + TLS)
   │  petition.srv1561000.hstgr.cloud  ──────────┐
   │  cyberstorm.srv1561000.hstgr.cloud ──────────┤
   ▼                                              │
Node.js Express (port 3000)  ◄────────────────────┘
   │
   ▼
SQLite 3 (signatures.db)
   │
   └── bind-mounted to host: /root/cyberstorm-data/
       (data persists across restarts, updates, reboots)
```

### Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 (Alpine Docker) |
| Backend | Express.js |
| Database | SQLite 3 via `better-sqlite3` |
| Proxy | Traefik v3.6.1 |
| SSL | Let's Encrypt (auto-renew) |
| Container | Docker (restart: unless-stopped) |
| OS | Ubuntu 24.04 LTS |
| Server | Hostinger KVM4 · Frankfurt · 4vCPU / 16GB / 200GB NVMe |

### API Endpoints

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/` | Petition token in URL | Serves petition form |
| `GET` | `/dashboard` | — | Serves dashboard (login screen) |
| `POST` | `/api/sign` | `petition_token` in body | Submit signature |
| `GET` | `/api/count` | Public | Total signature count |
| `POST` | `/api/dashboard/login` | Password | Returns session token |
| `GET` | `/api/dashboard/validate` | Session header | Validate session |
| `GET` | `/api/signatures` | Session header | All signatures (JSON) |
| `DELETE` | `/api/signatures/:ref` | Session header | Delete one signature |
| `POST` | `/api/import` | Session header | Bulk import |
| `GET` | `/api/export` | Session header | Download CSV |
| `GET` | `/health` | Public | Server health check |

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and fill your own values:

```bash
cp .env.example .env
nano .env
```

| Variable | Description | Example |
|---|---|---|
| `PETITION_TOKEN` | Secret token embedded in the form URL | `cs2026-mu-xxxxxx` |
| `DASHBOARD_PASSWORD` | Password to access the dashboard | `MyStrongPass2026!` |
| `SESSION_SECRET` | Random string for session signing | `64-char random string` |
| `PORT` | Internal port (default: 3000) | `3000` |

Generate secure random values:
```bash
node -e "const c=require('crypto'); console.log('PETITION_TOKEN='+c.randomBytes(18).toString('base64url')); console.log('DASHBOARD_PASSWORD='+c.randomBytes(14).toString('base64url')); console.log('SESSION_SECRET='+c.randomBytes(32).toString('base64url'));"
```

---

## 🚀 Deploy from Scratch (any server with Docker)

### Requirements
- Ubuntu 20.04+ (or any Linux)
- Docker 24+
- Docker Compose v2
- Traefik already running with `root_default` network and `mytlschallenge` cert resolver
- DNS: your domain pointing to the server IP

### Step 1 — Clone

```bash
git clone https://github.com/automindtechnologie-jpg/Cyberstorm.mu-to-the-citizens-of-Mauritius.git
cd Cyberstorm.mu-to-the-citizens-of-Mauritius
```

### Step 2 — Configure environment

```bash
cp .env.example .env
nano .env
# Fill: PETITION_TOKEN, DASHBOARD_PASSWORD, SESSION_SECRET
```

### Step 3 — Edit domains in docker-compose.yml

Open `docker-compose.yml` and replace the two domain rules:
```yaml
- "traefik.http.routers.cs-petition.rule=Host(`YOUR-PETITION-DOMAIN.com`)"
- "traefik.http.routers.cs-dashboard.rule=Host(`YOUR-DASHBOARD-DOMAIN.com`)"
```

### Step 4 — Deploy

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

Or manually:
```bash
mkdir -p ./data
docker compose build --no-cache
docker compose up -d
```

### Step 5 — Verify

```bash
docker ps | grep cyberstorm
docker logs cyberstorm-petition --tail 20
curl http://localhost:3000/health
```

---

## 🔄 Update (pull latest code + redeploy)

```bash
chmod +x scripts/update.sh
./scripts/update.sh
```

Or manually:
```bash
git pull origin main
docker compose build --no-cache
docker compose up -d --force-recreate
docker logs cyberstorm-petition --tail 20
```

---

## 🗄 Database Backup

The SQLite database is at:
```
/root/cyberstorm-data/signatures.db   # on the host server
/app/data/signatures.db               # inside the container
```

**Backup:**
```bash
cp /root/cyberstorm-data/signatures.db ./signatures-backup-$(date +%Y%m%d).db
```

**Restore:**
```bash
docker stop cyberstorm-petition
cp signatures-backup-YYYYMMDD.db /root/cyberstorm-data/signatures.db
docker start cyberstorm-petition
```

**Export to CSV from command line:**
```bash
sqlite3 /root/cyberstorm-data/signatures.db \
  ".headers on" ".mode csv" \
  "SELECT * FROM signatures ORDER BY timestamp;" \
  > signatures-$(date +%Y%m%d).csv
```

---

## 📊 Dashboard Guide

### Login
Open `https://your-dashboard-domain/dashboard` → enter the password.  
Session lasts 24 hours. You stay logged in across page refreshes.

### Top Bar Buttons

| Button | Function |
|---|---|
| 🟢 **LIVE** | Green dot = connected. Auto-refreshes every 5 seconds. New form signatures appear instantly without reload. |
| **⬇ Report** | Generates a complete formatted text block (copy-paste ready). Contains: total count, breakdown by date/hour, full list with name, email, phone, org and reference number. |
| **↗ Export CSV** | Downloads all signatures as `.csv` file. Opens in Excel, Google Sheets, Numbers. Columns: nom, prenom, email, tel, organisation, ref, source, timestamp. |
| **＋ Import** | Add signatories collected offline (paper forms, events…). Two modes: upload a CSV file (drag & drop) or paste manually one person per line. Preview before confirming. |
| **Logout** | Ends the session securely. |

### Timeline & Cards
- Signatures grouped by **date → hour** (newest first)
- Search bar: filter by name, email or reference number
- Toggle between **Timeline** view and **All List** view
- Click any card → opens full **Profile Fiche** (all fields + source + timestamp)
- 🗑 Delete button on every card (with confirmation)

### Stats Row (top of page)
- **Total Signatories** — all time
- **Today** — signatures on the current date
- **This Hour** — current hour window
- **Last Signature** — name + time of most recent signer

---

## 📋 Petition Form Guide

### How a citizen signs

1. Open the petition link (full URL with `?t=token`)
2. Watch the video (optional)
3. Read the petition text
4. Scroll to **"Add Your Voice"**
5. Fill: First Name, Last Name, Email *(required)*
6. Fill: Phone, Organisation *(optional)*
7. Tick the agreement checkbox
8. Click **"Send and Agree"**
9. Confirmation card appears with their reference number

### Validations
- All 3 required fields must be filled (shake animation + error if empty)
- Email format is validated
- Duplicate email: form shows the existing reference number
- Without the URL token: page is blocked entirely

---

## 🔧 Traefik Requirements (for self-hosting)

Your Traefik instance must have:

```yaml
# Required network (external)
networks:
  root_default:
    external: true

# Required in Traefik static config (traefik.yml or CLI args)
entryPoints:
  websecure:
    address: ":443"

certificatesResolvers:
  mytlschallenge:
    acme:
      email: your@email.com
      storage: /letsencrypt/acme.json
      httpChallenge:
        entryPoint: web
```

If your Traefik uses different names, update `docker-compose.yml`:
- `entrypoints=websecure` → your entrypoint name
- `certresolver=mytlschallenge` → your cert resolver name
- `root_default` → your external network name

---

## 🛠 Troubleshooting

| Problem | Solution |
|---|---|
| Site not loading | `docker logs cyberstorm-petition --tail 50` |
| SSL not working | Wait 60s after first start for Let's Encrypt. Check Traefik logs. |
| Data lost after restart | Verify bind mount: `docker inspect cyberstorm-petition \| grep Mounts` |
| Dashboard login fails | Check `.env` — `DASHBOARD_PASSWORD` must match |
| Form shows "Access Denied" | The URL must include `?t=YOUR_PETITION_TOKEN` |
| Container won't start | `docker compose down && docker compose up -d` |
| Rebuild from scratch | `docker compose down && docker compose build --no-cache && docker compose up -d` |

---

## 📦 One-File Deploy (no docker-compose, Docker socket only)

For servers where only the Docker socket is available (no CLI):

```bash
node scripts/deploy-socket.js
```

See `scripts/deploy-socket.js` for details.

---

*Delivered by Elemental Genesis Agent Labs · Jean Michel Rey · Tamarin, Mauritius*
