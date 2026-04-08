# Termi

<p align="center">
  <img src="./assets/termi_logo.png" alt="Termi logo" width="180">
</p>

Turn a local shell into a phone-friendly terminal you can open from a QR code.

Termi is a self-hosted Node.js CLI that runs a PTY on your machine, serves a lightweight mobile terminal UI, and exposes it through Cloudflare. It is built for checking output, keeping long-running sessions alive, and sending input from your phone without SSH or router setup.

## Features

- Quick tunnel mode with a fresh tokenized URL each run
- Persistent URL mode on your own Cloudflare-managed domain
- Pair-once trusted browsers for persistent sessions
- Mobile UI with a virtual keyboard, OS keyboard toggle, and drag-to-move cursor
- One-time mobile onboarding stored locally in `~/.termi`
- Local `devices` and `revoke` commands for managing trusted browsers

## Requirements

- Node.js 20+
- `npm`
- `git`
- macOS or Linux
- `cloudflared`

If `cloudflared` is not installed, Termi can download it during setup.

Persistent URL mode also requires:

- a Cloudflare account
- a domain managed in Cloudflare DNS

## Install

Quick install:

```bash
curl -fsSL https://raw.githubusercontent.com/denniszhao/termi/main/install.sh | bash
```

The install script:

- checks for Node.js 20+, `npm`, and `git`
- clones or updates the repo in `~/.termi`
- runs `npm ci` and `npm run build`
- symlinks `termi` to `~/.local/bin/termi`

If `~/.local/bin` is not on your `PATH`, add:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Manual install:

```bash
git clone https://github.com/denniszhao/termi.git ~/.termi
cd ~/.termi
npm ci
npm run build
mkdir -p ~/.local/bin
ln -sf "$HOME/.termi/dist/cli.mjs" "$HOME/.local/bin/termi"
```

## Usage

Start a session:

```bash
termi
```

Other commands:

```bash
termi start
termi devices
termi revoke
termi reset
termi --help
termi --version
```

## Modes

Quick tunnel:

- random `trycloudflare.com` URL each run
- protected by a per-session URL token
- no persistent browser trust state

Persistent URL:

- stable URL on your Cloudflare-managed domain
- first untrusted browser shows a pairing page
- trusted browsers reconnect without pairing again
- trusted devices are saved locally in `~/.termi/config.json`

## Session Flow

1. Termi checks for `cloudflared` and offers to download it if needed.
2. You choose a quick tunnel or persistent URL.
3. Termi starts a PTY using your current shell.
4. A local HTTP/WebSocket server is started and exposed through Cloudflare.
5. Termi prints a URL and QR code.
6. On persistent sessions, new browsers pair once and then become trusted.
7. You use the terminal from your phone.

## Mobile UI

- inline connection status block with a live state indicator
- virtual keyboard plus OS keyboard toggle on mobile
- drag on the terminal to move the text cursor
- one-time mobile onboarding, tracked locally in `~/.termi`

## Security

- Quick tunnel sessions require a random per-session token on both HTTP and WebSocket requests.
- Persistent sessions require a trusted-device cookie after pairing.
- Trusted-device cookies are `HttpOnly`, `Secure`, and `SameSite=Strict`.
- Token and trusted-device comparisons use constant-time checks.
- The local server listens on `127.0.0.1` only.
- Termi is a convenience tool for personal remote access, not a hardened multi-user remote access system.

Persistent mode stores Cloudflare credentials, tunnel config, trusted devices, and onboarding state under `~/.termi`.

## Resetting State

```bash
termi reset
```

This clears local persistent tunnel state, saved credentials, trusted devices, and onboarding state. It does not delete remote Cloudflare tunnels or DNS records.

## Development

```bash
npm ci
npm run build
npm run dev
npm run check
npm test
npm run test:server
```

Run the built CLI locally:

```bash
npm start
```

## License

MIT
