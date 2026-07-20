# conductor-remote

Phone control panel for **local** Conductor agents: a dependency-free Node relay
serves an installable React PWA, reads agent state, and relays prompts back into
Conductor. Deep dives live in [HANDOVER.md](./HANDOVER.md) (status, file map) and
[FINDINGS.md](./FINDINGS.md) (the Conductor reverse-engineering the design rests on).

## The load-bearing mental model

Two asymmetric halves — keep them separate:

- **Reads are uncoupled and durable.** All state comes from Conductor's local
  SQLite DB (`conductor.db`, opened **read-only** on a second connection) plus
  `git` in each worktree. No Conductor process is involved, no injection. An app
  update can rename every UI string and reads keep working. Never add a write to
  the DB handle in `db.ts`.
- **Writes are the one fragile nerve.** Prompts go back via the `Actuator`
  interface (`src/writes.ts`), two strategies:
  - `applescript` (**default**): drives Conductor's real UI send. Safe, but hits
    whichever session is *focused* — no per-session targeting.
  - `sidecar` (opt-in, `WRITE_STRATEGY=sidecar`): JSON-RPC over Conductor's unix
    socket, addresses a session by id. Precise but speaks a private `-v2-`
    protocol — the most update-fragile surface here. **A live `query` send injects
    a real prompt into a running agent; never auto-run it to "test."**

`sessions.id == claude_session_id` — Conductor is a GUI over Claude Code sessions.

## Commands

```bash
yarn verify   # typecheck (tsc) + lint (Biome) — run before every commit
yarn fix      # Biome autofix (format + safe lints)
yarn build    # Vite → dist/ (what the relay serves)
yarn start    # run the relay (node src/server.ts)
yarn dev      # Vite :5173 (HMR) proxying /api → relay :8787
yarn deploy   # build + install/reload the login LaunchAgent, print phone URL
yarn service  # {status,restart,uninstall} the LaunchAgent
```

There are no automated tests; `yarn verify` (typecheck + lint) is the gate.
Verify a runtime change by curling the relay (see the bind trap below), not by
unit test.

## Traps (these will bite)

- **Node flags are mandatory — and it's the *transform* flag, not strip.** The
  relay and scripts run under `node --experimental-transform-types
  --disable-warning=ExperimentalWarning`. `--experimental-transform-types`
  *transforms* runtime TS syntax, so enums and parameter properties work — `db.ts`
  relies on `constructor(private readonly dbPath)`. Do **not** switch to
  `--experimental-strip-types` (strip-only): it rejects those and breaks `db.ts`.
- **The relay binds loopback; the tailnet-facing URL comes from `tailscale serve`.**
  `server.listen` uses `127.0.0.1` (override with `RELAY_HOST`), and `yarn deploy`
  wires `tailscale serve --bg 8787` so the phone reaches a stable `https://<magicdns>/`
  (tailnet-only, real TLS — which the PWA service worker needs). `curl 127.0.0.1:8787`
  now works for local checks; `yarn service status` prints the phone URL.
- **Token is persisted**, not per-boot: `~/Library/Application Support/conductor-remote/token`
  (`config.ts` → `resolveToken`). Don't reintroduce a random-per-start token — it
  breaks the phone's saved home-screen URL. `RELAY_TOKEN` env still overrides.
- **Yarn is standalone here.** Its own `yarn.lock` + `.yarnrc.yml`
  (`nodeLinker: node-modules`) makes this its own project despite a `package.json`
  higher up in `$HOME`. `package.json` pins `yarn@4` via `packageManager`, so
  contexts without a corepack shim (CI, a bare shell) must `corepack enable` first
  — see `.github/workflows/ci.yml`. The verify script is named `verify`, not `check`
  (collides with a Yarn Classic builtin).
- **If a Conductor update breaks a read**, re-derive from the DB schema; if it
  breaks the sidecar write, re-derive from `conductor-runtime`. Both procedures
  are in HANDOVER ▸ "Re-deriving Conductor internals."

## Conventions

- **Biome** formats and lints (`biome.jsonc`): tabs, single quotes, no semicolons,
  no trailing commas, 120 cols, arrow parens as-needed. Don't hand-format — run `yarn fix`.
- **TS strict**, `verbatimModuleSyntax` (use `import type`), `.ts`/`.tsx` extensions
  in imports are required (`allowImportingTsExtensions`).
- **Layout:** `src/` = Node relay (server, db, reads, git, transcript, sidecar,
  writes, config). `web/` = Vite-root React PWA (`web/src/`). `scripts/` = dev,
  icon-gen, service installer. `dist/` = build output (gitignored, relay-served).
- **Utility scripts** default to `node --experimental-transform-types` TS, stdlib-only.
- **Commit author** is the GitHub noreply address (privacy) — keep it for public commits.
