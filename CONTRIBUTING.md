# Contributing

## Development Setup

```bash
npm ci
npm run build
npm run check
```

## Pull Requests

- keep changes focused
- update documentation for user-facing behavior changes
- avoid introducing breaking CLI changes without discussion
- include validation notes for anything that affects install, packaging, or tunnel setup

## Release Notes

For release-related changes, prefer GitHub as the primary distribution channel. npm support uses the package name `termi-cli` while keeping the installed command name `termi`.

For local installer testing, `install.sh` also accepts `TERMI_REPO_URL`, `TERMI_INSTALL_DIR`, and `TERMI_BIN_DIR` overrides.
