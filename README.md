# conductor-remote

A phone control panel for your **local** Conductor agents. Monitor every
workspace, read live transcripts, view diffs, and send prompts — from your
phone, over your Tailnet, no cloud, no App Store.

> Built after reconnaissance forced a design change from the original
> injected-IPC-bridge idea. Read **[FINDINGS.md](./FINDINGS.md)** for why — the
> short version is that reads ride SQLite + git (zero coupling) and the only
> Conductor-coupled surface is the prompt write, done via macOS Accessibility
> because webview injection is closed on the shipped, hardened build.

## Architecture

```
 Phone PWA  ──HTTP/poll──►  Relay (Node, on the Mac, bound to Tailscale)
 (add to home screen)                │
                                     ├─ reads:  node:sqlite ⟶ conductor.db   (workspaces, sessions, transcripts)
                                     ├─ reads:  git ⟶ each worktree           (diffs vs target branch)
                                     └─ writes: osascript ⟶ Accessibility ⟶ Conductor prompt box
```

- **Reads are durable.** No Conductor API, no injection — the SQLite schema and
  git worktrees outlive UI changes.
- **Writes are the one fragile nerve** and are isolated behind a swappable
  `Actuator` interface (`src/writes.ts`).

## Requirements

- Node ≥ 24 (uses built-in `node:sqlite` and native TS type-stripping — no build
  step, no dependencies).
- Conductor running on the same Mac.
- [Tailscale](https://tailscale.com) on the Mac and the phone (or any shared
  private network) to reach the relay.
- **Accessibility permission** for whatever runs the relay (Terminal/node):
  System Settings ▸ Privacy & Security ▸ Accessibility. Required for the write
  path; reads work without it.

## Run

```bash
git clone https://github.com/hyldmo/conductor-remote.git
cd conductor-remote
yarn start        # or: npm start   (just runs: node src/server.ts — no install needed)
```

The relay prints a phone URL with an embedded token:

```
Open on your phone (same Tailnet):
  http://100.x.y.z:8787/#token=<generated>
```

Open that on the phone and **Add to Home Screen**. The token is stored in
`localStorage`; every `/api/*` call must carry it, so other devices on the LAN
can't read your sessions.

### Config (env)

| Var | Default | Purpose |
| --- | --- | --- |
| `RELAY_PORT` | `8787` | Listen port |
| `RELAY_HOST` | auto (Tailscale `100.x`, else `127.0.0.1`) | Bind address |
| `RELAY_TOKEN` | random per boot | Set a stable secret so the phone URL doesn't change |
| `CONDUCTOR_DB` | `~/Library/Application Support/com.conductor.app/conductor.db` | State DB |
| `CONDUCTOR_WORKSPACES` | `~/conductor/workspaces` | Worktree root |
| `UNSAFE_DB_WRITE` | unset | Switch to the experimental raw-DB write path (see FINDINGS) |

Set a stable token so the home-screen icon keeps working across restarts:

```bash
RELAY_TOKEN=$(openssl rand -hex 16) yarn start
```

## What works today

- ✅ Live list of active workspaces with agent status (working / idle / done),
  branch, repo, unread badge.
- ✅ Live transcript per session (assistant text, tool calls, queued messages),
  incremental polling.
- ✅ Diff vs the workspace's target branch (file list + colorized patch).
- ⚠️ **Send prompt** via Accessibility — lands in the *focused* Conductor
  session. Per-workspace write targeting is the next step (see FINDINGS ▸ Writes
  and `src/writes.ts`).

## Layout

```
src/
  server.ts       HTTP router: /api/* (token-gated) + static PWA
  config.ts       paths, port, Tailscale bind, token
  db.ts           read-only node:sqlite handle to conductor.db
  reads.ts        workspaces / sessions / messages + worktree resolution
  transcript.ts   Claude Code SDK stream JSON → phone-renderable entries
  git.ts          workspace diff vs target branch
  writes.ts       Actuator interface + AppleScript (default) + DB-queue (experimental)
public/           the phone PWA (no build step)
scripts/
  devtools-recon.js   invoke-logger — only usable if a future build ships devtools
```

## Security notes

- The relay binds to your Tailnet IP (or loopback), not `0.0.0.0`.
- All data endpoints require the shared token; static shell assets are public
  but carry no secrets.
- The write path can drive your real agents — keep the token private and the
  bind address off untrusted networks.
- The relay reads Conductor's SQLite DB **read-only** and never writes to it
  (the experimental DB actuator is opt-in and off by default). Your data stays
  on your machine — nothing is sent anywhere.

## Disclaimer

Unofficial and not affiliated with, endorsed by, or supported by Conductor. It
reads your own local Conductor data and automates your own machine. It depends
on Conductor's on-disk layout (a SQLite DB + git worktrees), which is not a
public API and may change between Conductor releases — see
[FINDINGS.md](./FINDINGS.md) for how it's structured to keep breakage rare and
cheap to repair. macOS only.

## License

[MIT](./LICENSE)
