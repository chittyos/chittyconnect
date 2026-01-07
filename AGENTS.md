# Repository Guidelines

This guide helps contributors work effectively in this repository. It summarizes structure, workflows, and conventions tailored to ChittyConnect.

## Project Structure & Module Organization

- App and APIs: `src/` (Hono worker, routes under `src/api/routes/*`)
- Middleware & utils: `src/middleware/*`, `src/lib/*`
- Integrations & intelligence: `src/integrations/*`, `src/intelligence/*`
- GitHub/MCP tooling: `mcp-server.js`, `src/github/*`
- Config: `wrangler*.toml`, `package.json`
- CI: `.github/workflows/*`
- Docs: top‑level `README.md`; release notes via Release Drafter

## Build, Test, and Development Commands

- `npm install` — install dependencies
- `npm run dev` — local worker via Wrangler
- `npm run deploy[:staging|:production]` — deploy to Cloudflare
- `npm test` / `npm run test:watch` — run unit tests (Vitest)
- `npm run lint` — ESLint for `src/`
- `npm run format` — Prettier formatting
- `npm pack --dry-run` — preview published files

## Coding Style & Naming Conventions

- Language: modern JavaScript (ESM, `type: module`)
- Indentation: 2 spaces; no trailing whitespace
- Filenames: `kebab-case.js` for modules; test files under `__tests__` or `*.test.js`
- Imports: absolute within `src/` only when readable; prefer named exports
- Tools: ESLint, Prettier; run `npm run lint && npm run format` before PRs

## Testing Guidelines

- Framework: Vitest
- Location: `src/**/__tests__/*` and `*.test.js`
- Naming: mirror source paths (e.g., `src/api/router.test.js`)
- Run: `npm test`; add focused tests for routes/middleware you touch

## Commit & Pull Request Guidelines

- Commits: conventional style preferred (e.g., `feat:`, `fix:`, `chore:`)
- Scope clear, messages imperative; small, atomic changes
- PRs: include description, linked issues, test plan, and any config changes
- CI must pass; format and lint clean before request

## Security & Configuration Tips

- Secrets via Wrangler secrets and GitHub Actions secrets; never commit keys
- For npm publish, CI loads tokens via GitHub/1Password; local publishes require `--access public` for scoped packages

