# Termi

View and control a terminal session from your phone.

Termi is a self-hosted CLI tool that turns any terminal session into a secure, phone-accessible mobile terminal — especially useful for long-running Claude Code or Codex workflows.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/dz/termi/main/install.sh | bash
```

Requires Node.js 20+ and git.

## Usage

```bash
termi
```

Termi walks you through setup:

1. Choose connection mode — **Cloudflare Tunnel** (access from anywhere) or **Local** (same Wi-Fi)
2. If tunnel mode: cloudflared is detected or downloaded automatically
3. A terminal session starts and a URL + QR code is printed
4. Scan the QR code on your phone
5. You're in — view output and send input from your phone

## How it works

- Spawns a PTY shell on your machine
- Runs a local HTTP + WebSocket server serving a mobile terminal UI (xterm.js)
- Optionally creates a Cloudflare quick tunnel (no account needed) for access outside your network
- Auth via a random 256-bit token embedded in the URL

## Manual install

```bash
git clone https://github.com/dz/termi.git ~/.termi
cd ~/.termi
npm install
npm run build
node dist/cli.mjs
```

## Security

- 64-character random token in the URL (256 bits of entropy)
- Token validated on both HTTP and WebSocket connections (constant-time comparison)
- Cloudflare tunnel is encrypted end-to-end (HTTPS/WSS)
- No data stored on disk, no accounts, no central server

## Requirements

- Node.js 20+
- macOS or Linux
- cloudflared (auto-downloaded if not present, only needed for tunnel mode)

## License

MIT
