#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
//  Cyberstorm.mu — Docker Socket Deploy Script
//
//  Use this when Docker CLI is not available but
//  /var/run/docker.sock is accessible (e.g. inside a
//  container with the socket bind-mounted).
//
//  Usage: node scripts/deploy-socket.js
//
//  Requirements:
//  - Node.js 16+
//  - Access to /var/run/docker.sock
//  - .env file in project root
//  - Traefik running with root_default network
// ═══════════════════════════════════════════════════════

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SOCKET = '/var/run/docker.sock';
const IMAGE = 'cyberstorm-petition:latest';
const CONTAINER = 'cyberstorm-petition';
const DATA_DIR = '/root/cyberstorm-data';
const PAT = process.env.GITHUB_PAT || '';
const REPO = 'automindtechnologie-jpg/Cyberstorm.mu-to-the-citizens-of-Mauritius';

// Load .env
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('ERROR: .env file not found. Copy .env.example to .env first.');
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  lines.forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const [k, ...v] = line.split('=');
    env[k.trim()] = v.join('=').trim();
  });
  return env;
}

function api(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const bs = body ? JSON.stringify(body) : '';
    const req = http.request({
      socketPath: SOCKET, method, path: apiPath,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bs) }
    }, res => {
      let d = ''; res.on('data', x => d += x);
      res.on('end', () => {
        try { resolve({ s: res.statusCode, b: JSON.parse(d) }); }
        catch(e) { resolve({ s: res.statusCode, b: d }); }
      });
    });
    req.on('error', reject); if (bs) req.write(bs); req.end();
  });
}

// Create a minimal POSIX tar buffer from a single file (for Docker build context)
function makeTar(filename, content) {
  const cb = Buffer.from(content, 'utf8');
  const h = Buffer.alloc(512, 0);
  h.write(filename.slice(0, 99), 0);
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(cb.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
  h.fill(0x20, 148, 156); h.write('0', 156); h.write('ustar  \0', 257);
  let cs = 0; for (let i = 0; i < 512; i++) cs += h[i];
  h.write(cs.toString(8).padStart(6, '0') + '\0 ', 148);
  const ps = Math.ceil(cb.length / 512) * 512;
  const cp = Buffer.alloc(ps, 0); cb.copy(cp);
  return Buffer.concat([h, cp, Buffer.alloc(1024, 0)]);
}

function buildWithSocket(tarBuf, tag, buildArgs) {
  const baJson = buildArgs ? encodeURIComponent(JSON.stringify(buildArgs)) : '{}';
  const apiPath = `/build?t=${encodeURIComponent(tag)}&rm=1&buildargs=${baJson}`;
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: SOCKET, method: 'POST', path: apiPath,
      headers: { 'Content-Type': 'application/x-tar', 'Content-Length': tarBuf.length }
    }, res => {
      let d = ''; res.on('data', x => d += x);
      res.on('end', () => resolve({ s: res.statusCode, b: d }));
    });
    req.on('error', reject); req.write(tarBuf); req.end();
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Cyberstorm.mu — Docker Socket Deploy');
  console.log('═══════════════════════════════════════════════════════\n');

  const env = loadEnv();
  const envVars = Object.entries(env).filter(([k]) => k && !k.startsWith('#')).map(([k, v]) => `${k}=${v}`);
  console.log('✓ .env loaded:', envVars.map(e => e.split('=')[0]).join(', '));

  // Determine repo URL
  let repoUrl;
  if (PAT) {
    repoUrl = `https://${PAT}@github.com/${REPO}.git`;
    console.log('✓ Using PAT for private access');
  } else {
    repoUrl = `https://github.com/${REPO}.git`;
    console.log('✓ Using public repo URL');
  }

  // Dockerfile that clones from GitHub
  const dockerfile = `FROM node:20-alpine
RUN apk add --no-cache git
ARG REPO_URL
WORKDIR /app
RUN git clone $REPO_URL . 2>&1 | tail -5
RUN npm install --omit=dev 2>&1 | tail -3
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "server.js"]
`;

  // Step 1: Stop/remove old container
  console.log('\n[1/5] Removing old container...');
  await api('POST', `/containers/${CONTAINER}/stop`, { t: 5 });
  await api('DELETE', `/containers/${CONTAINER}?force=true`, null);
  console.log('  Done');

  // Step 2: Build
  console.log('\n[2/5] Building Docker image (git clone + npm install)...');
  const tarBuf = makeTar('Dockerfile', dockerfile);
  const buildRes = await buildWithSocket(tarBuf, IMAGE, { REPO_URL: repoUrl });
  const buildLines = buildRes.b.split('\n').filter(l => l.trim()).map(l => {
    try { const o = JSON.parse(l); return o.stream || o.error || ''; } catch(e) { return l; }
  }).filter(l => l.trim());
  buildLines.slice(-12).forEach(l => process.stdout.write('  ' + l + (l.endsWith('\n') ? '' : '\n')));
  const buildOk = buildLines.some(l => l.includes('Successfully tagged'));
  if (!buildOk) { console.error('  ⚠ Build may have failed. Check output above.'); }
  else { console.log('  ✓ Image built successfully'); }

  // Step 3: Create data dir
  console.log('\n[3/5] Creating data directory...');
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); console.log(`  ✓ ${DATA_DIR}`); }
  catch(e) { console.log(`  ✓ Using ${DATA_DIR} (may already exist)`); }

  // Step 4: Create container
  console.log('\n[4/5] Creating container...');
  const createRes = await api('POST', `/containers/create?name=${CONTAINER}`, {
    Image: IMAGE,
    Env: envVars,
    ExposedPorts: { '3000/tcp': {} },
    HostConfig: {
      Binds: [`${DATA_DIR}:/app/data`],
      RestartPolicy: { Name: 'unless-stopped' },
      NetworkMode: 'root_default'
    },
    NetworkingConfig: { EndpointsConfig: { 'root_default': {} } },
    Labels: {
      'traefik.enable': 'true',
      'traefik.docker.network': 'root_default',
      'traefik.http.routers.cs-petition.rule': 'Host(`petition.srv1561000.hstgr.cloud`)',
      'traefik.http.routers.cs-petition.entrypoints': 'websecure',
      'traefik.http.routers.cs-petition.tls': 'true',
      'traefik.http.routers.cs-petition.tls.certresolver': 'mytlschallenge',
      'traefik.http.routers.cs-petition.service': 'cs-svc',
      'traefik.http.routers.cs-dashboard.rule': 'Host(`cyberstorm.srv1561000.hstgr.cloud`)',
      'traefik.http.routers.cs-dashboard.entrypoints': 'websecure',
      'traefik.http.routers.cs-dashboard.tls': 'true',
      'traefik.http.routers.cs-dashboard.tls.certresolver': 'mytlschallenge',
      'traefik.http.routers.cs-dashboard.service': 'cs-svc',
      'traefik.http.services.cs-svc.loadbalancer.server.port': '3000'
    }
  });
  console.log('  Create status:', createRes.s, createRes.b.Id ? `ID: ${createRes.b.Id.slice(0, 12)}` : JSON.stringify(createRes.b).slice(0, 100));

  // Step 5: Start
  console.log('\n[5/5] Starting container...');
  const startRes = await api('POST', `/containers/${CONTAINER}/start`, {});
  console.log('  Start status:', startRes.s);

  await new Promise(r => setTimeout(r, 4000));

  const info = await api('GET', `/containers/${CONTAINER}/json`, null);
  const st = info.b.State;
  const running = st && st.Running;

  console.log('\n  State:', st && st.Status, '| Running:', running);

  if (running) {
    const token = env.PETITION_TOKEN || '(see .env)';
    const pass = env.DASHBOARD_PASSWORD || '(see .env)';
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  ✅ DEPLOYED SUCCESSFULLY');
    console.log('═══════════════════════════════════════════════════════');
    console.log('\n  PETITION FORM:');
    console.log(`  https://petition.srv1561000.hstgr.cloud/?t=${token}`);
    console.log('\n  DASHBOARD:');
    console.log('  https://cyberstorm.srv1561000.hstgr.cloud/dashboard');
    console.log(`  Password: ${pass}`);
    console.log('\n═══════════════════════════════════════════════════════\n');
  } else {
    console.error('\n❌ Container not running. Getting logs...');
    const logs = await api('GET', `/containers/${CONTAINER}/logs?stdout=1&stderr=1&tail=30`, null);
    const logStr = Buffer.isBuffer(logs.b) ? logs.b.toString() : String(logs.b);
    console.log(logStr.replace(/[\x00-\x08\x0e-\x1f]/g, '').slice(0, 1500));
    process.exit(1);
  }
}

main().catch(e => { console.error('FATAL:', e.message, '\n', e.stack); process.exit(1); });
