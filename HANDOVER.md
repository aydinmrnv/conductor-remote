# Handover — continue here

Snapshot for picking this up cold (last updated 2026-07-19). Read
[README.md](./README.md) for usage and [FINDINGS.md](./FINDINGS.md) for the
reverse-engineering that shaped the design. This file is the "what's done, what's
next, how to resume" map.

## Where it stands

v1 scaffold, built and **verified against a live Conductor on macOS**.

- **Reads — done and working.** SQLite (`conductor.db`) + `git` per worktree.
  Verified end-to-end: workspace list with live agent status/model/context %,
  transcript parsing (tested on a 396-message session — text, tool calls, tool
  results, queued messages), diff vs target branch **including untracked files**,
  token auth, static PWA + SPA fallback, Tailscale bind detection.
- **Writes — implemented, NOT verified live.** The default `AppleScriptActuator`
  drives Conductor's real send path (activate → paste → Enter) but types into
  whichever session is **focused**. Per-workspace targeting is the main open
  item. It was deliberately not tested live to avoid injecting a prompt into a
  running agent.

## Run

```bash
yarn start          # node src/server.ts — no install, zero deps (Node 24)
```

Prints `http://<tailnet-ip>:8787/#token=<token>`. Open on phone → Add to Home
Screen. Reads work immediately; the write path needs macOS Accessibility
permission for the terminal/node process (System Settings ▸ Privacy & Security ▸
Accessibility).

## Open work, in priority order

1. **Write targeting — the real gap.** Make a prompt hit a *specific* workspace,
   not just the focused one. Two avenues, both in `src/writes.ts`:
   - **AX tree map.** Open Accessibility Inspector, hover Conductor's sidebar
     rows + the prompt `textarea`, capture their AX identifiers. Then script:
     focus the target workspace row → paste → Enter. Most reliable.
   - **`conductor://` deep link.** The URL scheme is registered
     (`CFBundleURLSchemes = [conductor]`, `tauri-plugin-deep-link`). Probe routes
     — e.g. `open "conductor://workspace/<id>"` — to focus a workspace before
     typing. Routes are unmapped; discovery needed. Watch the app's behavior with
     `log stream --predicate 'process == "conductor"'` while triggering links.
2. **`claude --resume` fallback actuator.** `sessions.id == claude_session_id`
   and each worktree is a normal repo, so `claude --resume <id> -p "<prompt>"`
   run in the worktree executes the turn with **zero Conductor coupling**.
   Trade-off: a second agent on the same session can conflict with Conductor's
   own management and its UI won't reflect the turn until it re-reads. Wire it
   behind a flag next to the AppleScript actuator and compare UX.
3. **Validate the DB-queue actuator.** `DbQueueActuator` is a stub. Test whether
   inserting a `session_messages` row (mirroring a real prompt) actually
   *dispatches* or just shows a ghost message — see FINDINGS ▸ Writes. Only ship
   if it dispatches and doesn't race the app's writer.
4. **SSE push** instead of the phone polling every ~2s (optional; polling is
   fine over a LAN/tailnet and simpler).
5. **Session picker.** The API already returns all sessions per workspace
   (`/api/workspaces/:id/sessions`); the PWA only opens the active one. Add a
   picker if you want history/side sessions.

## File map

```
src/server.ts     HTTP router: /api/* (token-gated) + static PWA
src/config.ts     paths, port, Tailscale bind, token, env
src/db.ts         read-only node:sqlite handle to conductor.db
src/reads.ts      workspaces / sessions / messages + worktree resolution
src/transcript.ts Claude Code SDK stream JSON → phone-renderable entries
src/git.ts        workspace diff vs target branch (incl. untracked via --no-index)
src/writes.ts     Actuator interface + AppleScript (default) + DB-queue (stub)
public/           the phone PWA (no build step): index.html, app.js, styles.css, sw.js
scripts/devtools-recon.js  invoke-logger — only usable if a future build ships devtools
```

## Re-deriving Conductor internals (if a Conductor update breaks a read)

Conductor's on-disk layout is not a public API. If a read stops working after a
Conductor update, re-inspect:

```bash
DB="$HOME/Library/Application Support/com.conductor.app/conductor.db"
sqlite3 "file:$DB?mode=ro" ".schema"                      # tables/columns
sqlite3 "file:$DB?mode=ro" "SELECT state,COUNT(*) FROM workspaces GROUP BY state"
sqlite3 "file:$DB?mode=ro" "SELECT id,status,workspace_id,title FROM sessions ORDER BY updated_at DESC LIMIT 5"
```

Key facts the code relies on: `workspaces.state='ready'` = live; `sessions.status`
∈ {working, idle}; `session_messages.content` is Claude Code SDK stream JSON for
assistant/system rows and plain text for user prompts; `queue_order` set +
`sent_at` null = queued-unsent; worktrees at
`<workspacesRoot>/<repo.name>/<directory_name>` (verified against
`git worktree list`).

Write-path recon (if you revisit injection): `codesign -d --entitlements :-`
on the binary (no `get-task-allow` ⇒ no devtools), `strings` on the binary for
IPC command names (only stock `plugin:*` today), and `Resources/bin/conductor`
(a cloud-only CLI — needs an `api.conductor.build` token).

## Gotchas

- **Node flags matter.** `--experimental-transform-types` is required (strip-only
  mode rejects TS parameter properties, used in `db.ts`/`reads.ts`). `node:sqlite`
  is experimental; the warning is silenced with `--disable-warning=ExperimentalWarning`.
- **`yarn check` is a Yarn Classic builtin** — the verify script is named
  `yarn verify` to avoid the collision (CI uses it too).
- **Commit author** is set repo-locally to the GitHub noreply address (privacy);
  keep it that way for public commits.
- A redundant copy of this code still lives in the `macromaxxing` Conductor
  worktree that spawned it (`conductor-ipc-bridge` branch, untracked). Safe to
  `rm -rf` there — this repo is canonical.
