# Termi

<p align="center">
  <img src="./assets/termi_logo.png" alt="Termi logo" width="180">
</p>

Turn a local shell into a phone-friendly terminal you can open from a QR code.

Termi is a self-hosted Node.js CLI that runs a PTY on your machine, serves a lightweight mobile terminal UI, and exposes it through a Cloudflare tunnel. Built for checking output, keeping long-running sessions alive, and sending input from your phone — no SSH or router setup needed.

## Features

- **Quick tunnel** — random `trycloudflare.com` URL each run with ephemeral browser pairing
- **Persistent URL** — stable URL on your own Cloudflare domain with pair-once trusted browsers
- **Mobile terminal UI** — virtual keyboard, OS keyboard toggle, scrollable terminal history
- **Manage trusted browsers** — `termi devices` and `termi revoke`

## Requirements

- Node.js 20+
- macOS or Linux

Termi will download `cloudflared` automatically if it isn't installed. Persistent URL mode also requires a Cloudflare account with a domain managed in Cloudflare DNS.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/denniszhao/termi/main/install.sh | bash
```

This clones the repo to `~/.termi`, builds it, and symlinks `termi` to `~/.local/bin/termi`. If `~/.local/bin` is not on your `PATH`, add:

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

```bash
termi              # start a session (interactive wizard)
termi devices      # list trusted browsers
termi revoke       # revoke trusted browsers
termi reset        # clear local tunnel config and credentials
termi --help
```

## Modes

**Quick tunnel** — A random `trycloudflare.com` URL is generated each run. Browsers pair explicitly through local approval, receive an ephemeral cookie, and are not remembered after the session ends. Cloudflare DNS for the quick-tunnel URL can take a few minutes to become reachable, so if the page does not load right away, wait a bit and try again.

**Persistent URL** — A stable URL on your Cloudflare domain. New browsers go through a local approval flow (a 6-character code is verified on both sides), then become trusted. Trusted browsers reconnect without pairing again.

## Security

- All traffic is routed through Cloudflare's HTTPS tunnel — the local server only listens on `127.0.0.1`.
- Quick tunnel sessions use explicit local approval plus an ephemeral `HttpOnly`, `Secure`, `SameSite=Strict` session cookie.
- Persistent sessions use remembered trusted-device cookies with the same cookie protections after local approval.
- Only one remote browser is active at a time; replacement and takeover are explicit.
- Termi is a convenience tool for personal remote access, not a hardened multi-user system.

## Resetting State

```bash
termi reset
```

Clears local tunnel config, saved credentials, trusted devices, and onboarding state. Does not delete remote Cloudflare tunnels or DNS records.

## Development

```bash
npm ci              # install dependencies
npm run build       # compile TypeScript
npm run dev         # rebuild on file changes
npm start           # run the built CLI
npm test            # run unit tests
npm run test:server # run integration tests (starts a real server)
npm run check       # build + verify CLI loads
```

## License

MIT
