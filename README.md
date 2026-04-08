# Termi

<p align="center">
  <img src="./assets/termi_logo.png" alt="Termi logo" width="180">
</p>

Turn a local shell into a phone-friendly terminal you can open from a QR code.

Termi is a self-hosted Node.js CLI for starting a terminal session on your machine and exposing it through a simple mobile web UI. It is aimed at long-running local workflows where you want to check output, keep a session alive, or send input from your phone without SSH setup, tmux wrangling, or port-forwarding.

## Features

- Starts an interactive PTY-backed shell session on your machine
- Serves a lightweight mobile terminal UI over HTTP and WebSocket
- Prints a URL and QR code so you can open the session quickly on your phone
- Supports both Cloudflare Quick Tunnels and persistent URLs on your own Cloudflare domain
- Generates a per-session access token and validates it for both page load and socket upgrade
- Keeps setup local and simple: no account system, no hosted backend

## Installation

### Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/denniszhao/termi/main/install.sh | bash
```

The installer:

- checks for Node.js 20+, `npm`, and `git`
- clones or updates the repo in `~/.termi`
- installs dependencies and builds the CLI
- symlinks `termi` into `~/.local/bin/termi`

If `~/.local/bin` is not already on your `PATH`, add:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### Manual install

```bash
git clone https://github.com/denniszhao/termi.git ~/.termi
cd ~/.termi
npm install
npm run build
mkdir -p ~/.local/bin
ln -sf "$HOME/.termi/dist/cli.mjs" "$HOME/.local/bin/termi"
```

## Requirements

- Node.js 20 or newer
- `npm`
- `git`
- macOS or Linux
- `cloudflared` for exposing sessions to your phone

Persistent URL mode also requires:

- a Cloudflare account
- a domain managed in Cloudflare DNS

If `cloudflared` is not installed, Termi can download it during setup.

## Usage

Start a session:

```bash
termi
```

Equivalent explicit command:

```bash
termi start
```

Other commands:

```bash
termi --help
termi --version
termi reset
```

### What happens when you run it

1. Termi checks for `cloudflared` and offers to download it if needed.
2. If you already configured a persistent URL, Termi lets you choose whether to reuse it, start a quick tunnel, or set up a new persistent URL.
3. Otherwise, you choose between a quick tunnel and a persistent URL.
4. Termi starts a shell session using your current `SHELL` value.
5. A local server is started and exposed through Cloudflare.
6. A session URL plus QR code are printed in your terminal.
7. You open the link on your phone and interact with the terminal from the browser.

## Access Model

Termi exposes the session running on your machine through Cloudflare. It supports two modes:

- Quick tunnel
  Random `trycloudflare.com` URL each run, with no account setup beyond `cloudflared`.
- Persistent URL
  Stable URL on your own Cloudflare-managed domain, saved locally and reused on later runs.

That keeps the setup simple:

- no SSH setup
- no router or firewall configuration
- no need for your phone and computer to be on the same network

If `cloudflared` is already installed, Termi uses it. Otherwise it can download a compatible binary during setup.

## Persistent URLs

Persistent mode walks through:

1. Cloudflare login
2. Domain selection or manual domain entry
3. Subdomain selection
4. Tunnel creation and DNS routing
5. Saving tunnel metadata for reuse

Saved persistent tunnel state lives under `~/.termi`. Run `termi reset` to clear the saved local tunnel config, credentials, and temporary tunnel files, then go through setup again.
This does not delete remote Cloudflare tunnels or DNS records.

## How It Works

- Termi spawns a PTY-backed shell on your machine
- an HTTP server serves the mobile client
- a WebSocket stream carries terminal input and output
- a fresh per-session token is added to the URL and checked on both HTTP and WebSocket requests
- `cloudflared` exposes the local session through either a temporary `trycloudflare.com` URL or a configured Cloudflare hostname

## Security Notes

- each session gets a randomly generated URL token
- token validation uses constant-time comparison
- the session UI is not public without the tokenized URL
- quick tunnel mode does not require an external application server
- Termi does not persist terminal output as part of its normal session flow

Persistent mode stores Cloudflare-related files locally in `~/.termi`, including saved tunnel config, certificates, and credentials used to reconnect the tunnel.

This is a convenience tool for personal remote access, not a hardened multi-user remote access system. Treat the session URL as a secret.

## Development

Install dependencies:

```bash
npm install
```

Build once:

```bash
npm run build
```

Watch and rebuild during development:

```bash
npm run dev
```

Run the built CLI locally:

```bash
npm start
```

## License

MIT
