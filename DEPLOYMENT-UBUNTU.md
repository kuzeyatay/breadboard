# Breadboard on Ubuntu

This repo runs best in production as three pieces:

1. `dashboard` on `breadboard-app.com`
2. `quartz` as a static site on `garden.breadboard-app.com`
3. `chatmock` available to the dashboard, either on localhost only or on a host URL if you want to use the dashboard `Chat` switch

That layout matches the current codebase well:

- the dashboard expects Quartz at `NEXT_PUBLIC_QUARTZ_URL`
- Quartz is embedded in the dashboard with an iframe
- the dashboard talks to an OpenAI-compatible backend through `OPENAI_BASE_URL`

## Recommended domain layout

Use:

- `breadboard-app.com` -> Next.js dashboard
- `www.breadboard-app.com` -> redirect to `breadboard-app.com`
- `garden.breadboard-app.com` -> Quartz static garden

This is easier than trying to mount Quartz under `/garden` on the same hostname.

## 1. Prepare the server

Install the basics:

```bash
sudo apt update
sudo apt install -y git curl build-essential python3 python3-venv python3-pip caddy
```

Install Node.js 22.x however you prefer. `nvm` is usually the least painful on older Ubuntu installs.

Verify:

```bash
node -v
npm -v
python3 --version
```

The repo currently expects:

- Node.js `22+`
- npm `10+`
- Python `3.11+`

## 2. Add swap first

On a 4 GB machine, add swap before builds. This helps with `next build`, native modules, and Quartz.

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

## 3. Clone the repo

Example location:

```bash
sudo mkdir -p /opt/breadboard
sudo chown "$USER":"$USER" /opt/breadboard
git clone https://github.com/kuzeyatay/breadboard.git /opt/breadboard
cd /opt/breadboard
```

## 4. Install dependencies

Dashboard:

```bash
cd /opt/breadboard/dashboard
npm ci
```

Quartz:

```bash
cd /opt/breadboard/quartz
npm ci
```

ChatMock:

```bash
cd /opt/breadboard/chatmock
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e .
deactivate
```

## 5. Log ChatMock in once

Do this interactively before turning it into a service:

```bash
cd /opt/breadboard/chatmock
source .venv/bin/activate
chatmock login
deactivate
```

If you plan to run the service as a dedicated user like `breadboard`, do the login as that same user so the auth file lands in the correct home directory.

## 6. Configure the dashboard environment

Create `dashboard/.env.production`:

```env
NEXTAUTH_SECRET=replace-with-a-long-random-secret
NEXTAUTH_URL=https://breadboard-app.com

OPENAI_BASE_URL=http://127.0.0.1:8765/v1
OPENAI_LOCAL_BASE_URL=http://127.0.0.1:8765/v1
OPENAI_HOST_BASE_URL=http://YOUR_HOST_OR_IP:8765/v1
OPENAI_API_KEY=local

NEXT_PUBLIC_QUARTZ_URL=https://garden.breadboard-app.com
QUARTZ_CONTENT_PATH=/opt/breadboard/quartz/content
QUARTZ_CUSTOM_OG_IMAGES=false
QUARTZ_BUILD_CONCURRENCY=1
# Optional on a slow box: QUARTZ_PUBLISH_MODE=background
SECOND_BRAIN_INITIAL_INVITE_CODE=YOURINVITECODE
```

Notes:

- `OPENAI_API_KEY` can be any non-empty string when using ChatMock locally.
- `OPENAI_LOCAL_BASE_URL` is used when the dashboard `Chat` selector is set to `Localhost`.
- `OPENAI_HOST_BASE_URL` is used when the dashboard `Chat` selector is set to `Host`.
- If you do not care about the selector, you can point all three OpenAI variables at the same ChatMock endpoint.
- `QUARTZ_CONTENT_PATH` should be an absolute path on the server.
- `NEXT_PUBLIC_QUARTZ_URL` must be the externally reachable Quartz URL, including `https://`.
- In production, the dashboard now auto-runs a Quartz rebuild after cluster and markdown changes so `quartz/public` stays in sync.
- `QUARTZ_BUILD_CONCURRENCY=1` keeps Quartz on a single worker, which is friendlier on a 4 GB machine.
- If Quartz publish latency feels too slow, set `QUARTZ_PUBLISH_MODE=background` so the dashboard returns sooner and Quartz catches up asynchronously.

## 7. Configure Quartz for production

Quartz now supports env-based host configuration in this repo.

When building Quartz, set:

```bash
export QUARTZ_BASE_URL=garden.breadboard-app.com
```

Optional low-memory optimization:

```bash
export QUARTZ_CUSTOM_OG_IMAGES=false
```

That disables generated Open Graph images, which can reduce build pressure on a small machine.

## 8. Build for production

Dashboard:

```bash
cd /opt/breadboard/dashboard
NODE_OPTIONS=--max-old-space-size=768 npm run build
```

Quartz:

```bash
cd /opt/breadboard/quartz
QUARTZ_BASE_URL=garden.breadboard-app.com QUARTZ_CUSTOM_OG_IMAGES=false npx quartz build
```

Quartz output is served from:

```text
/opt/breadboard/quartz/public
```

You still need this initial Quartz build once during deployment. After that, content mutations from the dashboard will auto-publish Quartz in production.

## 9. Create systemd services

### Dashboard service

Create `/etc/systemd/system/breadboard-dashboard.service`:

```ini
[Unit]
Description=Breadboard dashboard
After=network.target

[Service]
Type=simple
User=breadboard
Group=breadboard
WorkingDirectory=/opt/breadboard/dashboard
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=768
EnvironmentFile=/opt/breadboard/dashboard/.env.production
ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### ChatMock service

Create `/etc/systemd/system/breadboard-chatmock.service`:

```ini
[Unit]
Description=ChatMock local OpenAI-compatible server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=breadboard
Group=breadboard
Environment=HOME=/home/breadboard
WorkingDirectory=/opt/breadboard/chatmock
ExecStart=/opt/breadboard/chatmock/.venv/bin/chatmock serve --host 127.0.0.1 --port 8765 --reasoning-effort low --reasoning-summary none
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

If you want the dashboard `Chat` selector to switch between a real `Localhost` target and a real `Host` target, change the ChatMock bind host to `0.0.0.0` instead:

```ini
ExecStart=/opt/breadboard/chatmock/.venv/bin/chatmock serve --host 0.0.0.0 --port 8765 --reasoning-effort low --reasoning-summary none
```

Then set `OPENAI_HOST_BASE_URL` to the host/IP you want the dashboard to use for `Host`.

Then enable both:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now breadboard-chatmock
sudo systemctl enable --now breadboard-dashboard
sudo systemctl status breadboard-chatmock
sudo systemctl status breadboard-dashboard
```

## 10. Put Caddy in front

Create `/etc/caddy/Caddyfile`:

```caddy
www.breadboard-app.com {
  redir https://breadboard-app.com{uri}
}

breadboard-app.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}

garden.breadboard-app.com {
  encode zstd gzip
  root * /opt/breadboard/quartz/public
  try_files {path} {path}/ {path}.html
  file_server
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

Important:

- do not expose ChatMock publicly
- keep ChatMock bound to `127.0.0.1`
- do not add response headers that block `garden.breadboard-app.com` from being embedded in an iframe by `breadboard-app.com`

If you intentionally use the dashboard `Chat` switch with a real public `Host` target:

- bind ChatMock to `0.0.0.0`
- set `OPENAI_HOST_BASE_URL` explicitly
- consider firewalling or restricting port `8765` if possible

## 11. Point the domain at your house

At your DNS provider, add:

- `A` record for `@` -> your home public IP
- `A` record for `www` -> same IP
- `A` record for `garden` -> same IP

At your router, forward:

- TCP `80` -> Ubuntu machine
- TCP `443` -> Ubuntu machine

If you want the dashboard `Chat` switch to use a real external `Host` endpoint:

- TCP `8765` -> Ubuntu machine

If your home IP changes often, set up dynamic DNS or use a DNS provider/API updater.

If your ISP uses CGNAT and you do not have a real public IPv4 address, direct inbound hosting will not work reliably. In that case use one of these instead:

- a reverse tunnel
- a small VPS as a public proxy
- Tailscale Funnel or Cloudflare Tunnel

## 12. Test the deployment

Check the local services first:

```bash
curl http://127.0.0.1:8765/v1/models
curl -I http://127.0.0.1:3000
curl -I http://127.0.0.1
```

Then test the public URLs:

- `https://breadboard-app.com`
- `https://garden.breadboard-app.com`

The dashboard should load, and garden pages inside the dashboard should point at the `garden.` subdomain.

## 13. Updating later

When you pull changes:

```bash
cd /opt/breadboard
git pull

cd /opt/breadboard/dashboard
npm ci
NODE_OPTIONS=--max-old-space-size=768 npm run build
sudo systemctl restart breadboard-dashboard

cd /opt/breadboard/quartz
npm ci
QUARTZ_BASE_URL=garden.breadboard-app.com QUARTZ_CUSTOM_OG_IMAGES=false npx quartz build
sudo systemctl reload caddy
```

The manual Quartz build above is still needed after pulling code changes. Day-to-day cluster, note, and source document edits now trigger Quartz republishes automatically from the dashboard service.

ChatMock only needs reinstalling if its Python dependencies change:

```bash
cd /opt/breadboard/chatmock
source .venv/bin/activate
pip install -e .
deactivate
sudo systemctl restart breadboard-chatmock
```

## What I would do on a 4 GB box

If this were my machine, I would keep it simple:

- production builds only
- `breadboard-app.com` for the dashboard
- `garden.breadboard-app.com` for Quartz
- ChatMock on localhost only
- 4 GB swap enabled
- `QUARTZ_CUSTOM_OG_IMAGES=false`

That is the lowest-friction setup that fits the current repo cleanly.
