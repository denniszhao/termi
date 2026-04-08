Termi

A CLI-first tool that lets you view and control a terminal session from your phone.

Core idea

You install termi on a machine that is already running your own tools, like Claude Code or Codex. Termi starts a local terminal relay, exposes it securely to your phone, and gives you a mobile web UI for interacting with that same terminal session.

MVP spec
• Local-only architecture
• no Termi-managed backend
• no central server
• user installs and runs everything locally
• CLI setup
• one command, like termi start
• auto-detects environment
• installs or checks required dependencies
• starts the local relay and networking layer
• Terminal session
• launches or attaches to a PTY-backed shell
• supports running Claude Code, Codex, or any terminal program
• ideally supports persistent sessions via tmux
• Mobile access
• prints a URL and QR code in the CLI
• phone opens a mobile-friendly web terminal
• user can both view output and send input
• Transport
• secure remote access via user-managed networking, likely Cloudflare Tunnel or similar
• Termi automates as much of this setup as possible from the CLI
• Auth for MVP
• no separate account system
• simplest version uses a private, hard-to-guess session URL or local auth flow
• UI
• live terminal stream
• text input / command sending from phone
• basic session controls like reconnect, copy, stop

Nice-to-have next
• multiple sessions
• read-only mode
• device pairing / revocation
• notifications when the terminal is waiting or finishes
• better mobile controls than raw terminal typing

Non-goals for MVP
• hosting Claude/Codex itself
• multi-user collaboration
• centralized Termi cloud service
• complex auth/account management

One-line summary

Termi is a self-hosted CLI tool that turns any terminal session into a secure, phone-accessible mobile terminal, especially for long-running Claude Code or Codex workflows.
