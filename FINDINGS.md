# Reconnaissance findings

Everything here was verified against the installed build, not assumed.
**Conductor 0.76.0**, `com.conductor.app`, Tauri v2 app, macOS (Darwin 25.5).

## TL;DR — the plan changed under the evidence

The committed design was "confine coupling to writes, do writes via an injected
script that calls Tauri `invoke(...)`." Recon showed two things that reshape it:

1. **Reads need zero Conductor coupling and zero injection.** All state —
   workspaces, live session status, and the *complete* transcript of every
   agent — lives in a local SQLite DB. Diffs come from the git worktrees. We
   read both directly.
2. **The webview-injection write path is effectively closed on this build.**
   The app is hardened/notarized, its frontend is compiled into the binary
   (nothing to patch), devtools are off (nothing to paste the recon snippet
   into), and the only IPC commands that exist are stock Tauri plugins — there
   is no custom `send_message` to call even if you got inside.

So the architecture is now: **reads over SQLite + git (durable, uncoupled);
writes over macOS Accessibility (the one fragile nerve).** That is still the
"one coupled surface" the plan wanted — just realized through AX, not IPC.

---

## Reads — solved, and better than the "tail files" idea

### State DB (the goldmine)
`~/Library/Application Support/com.conductor.app/conductor.db` — SQLite in WAL
mode. A second **read-only** connection sees every committed write live without
touching the app. Relevant tables:

- `workspaces` — `id, directory_name, workspace_name, branch, state, derived_status, active_session_id, unread, intended_target_branch, …`. `state` is `ready` (live) or `archived`; `derived_status` is `in-progress` / `done`.
- `sessions` — `id, status ('working'|'idle'), workspace_id, title, model, permission_mode, context_used_percent, updated_at`. **Live agent status, for free.**
- `session_messages` — `session_id, role, content, full_message, created_at, sent_at, queue_order, turn_id`. Assistant/system rows store raw Claude Code SDK stream JSON; user prompts store plain text. `queue_order` set + `sent_at` null ⇒ a queued-but-unsent message. **This is the full transcript.**
- `repos` — `id, name, root_path, default_branch`. `root_path` is the primary checkout; worktrees live at `<workspacesRoot>/<repo.name>/<directory_name>`.
- `diff_comments`, `terminal_sessions`, `attachments`, `settings` — secondary.

Crucially, **Conductor's `sessions.id` equals the Claude Code `claude_session_id`** — the app is a GUI over Claude Code sessions.

### Diffs
Every workspace is a real git worktree (`git worktree list` confirms). Diff vs
the target branch is `git -C <worktree> diff $(git merge-base <base> HEAD)` —
committed + uncommitted, exactly Conductor's diff view, computed with no
Conductor involvement at all.

**Durability:** an app update can rename every UI string and both read paths
keep working. The schema has migrated additively (`_sqlx_migrations`, many
`ALTER TABLE ADD COLUMN`), so column adds won't break us; only a destructive
rename of `session_messages`/`sessions` would, and that's rare and cheap to remap.

---

## Writes — the real problem, honestly

### ✗ Webview injection + Tauri `invoke` (the committed plan) — blocked
- **Frontend is baked into the binary.** `Contents/Resources/` holds only `icon.icns`, a `bin/` (helpers), and the skill bundle — **no `index.html`, no `assets/`.** The Tauri runtime + all web assets are compiled into `Contents/MacOS/conductor`. There is nothing on disk to patch a `<script>` into, so the "patch index.html + launchd re-patch" persistence mechanism has no target.
- **No devtools.** Entitlements are only `allow-jit`, `allow-unsigned-executable-memory`, `device.audio-input` — **no `com.apple.security.get-task-allow`.** On macOS 13.3+ a `WKWebView` is inspectable only if the app opts in; a hardened, notarized production build without `get-task-allow` won't appear in Safari's Develop menu. **There is no console to run the recon snippet in.**
- **No custom IPC commands anyway.** Dumping the invoke handlers from the binary shows only stock plugins: `plugin:sql|execute`, `plugin:sql|select`, `plugin:shell|spawn`, `plugin:shell|stdin_write`, `plugin:fs|*`, `plugin:window|*`, etc. Conductor drives the agent by writing the DB via `plugin:sql` and feeding a `claude` subprocess via `plugin:shell`. There is no `send_message`/`create_session` command to reverse-engineer.

Getting inside would mean re-signing the app with `get-task-allow` (breaks
notarization, needs Gatekeeper disabled) or attaching a debugger under disabled
SIP — heavier and more fragile than the plan assumed. The recon snippet is kept
in `scripts/devtools-recon.js` for a hypothetical future build that ships
devtools, but it can't run today.

### ✗ Supported public API / CLI / MCP — cloud only
`Contents/Resources/bin/conductor` is a real CLI ("Command-line interface for
the Conductor public API") with `messages create` (queue a user message),
`sessions`, `workspaces`, read-only `sql`, `openapi`, and even `--mcp` stdio
mode. But it targets **`https://api.conductor.build`** and requires a token from
`app.conductor.build/users/api-keys`; `workspaces` are "cloud workspaces." With
no cloud access it can't see or drive local sessions — confirmed: `sql` errors
`No API token found`. Dead for local control, matching the earlier conclusion.

### ✗ Raw DB insert alone — probably a ghost
User prompts *are* rows in `session_messages` (`role='user'`, `queue_order`,
`sent_at`, `sender_id`). But the dispatch is done by Conductor's Rust backend
feeding the `claude` subprocess — the row is a *record* of that, almost
certainly not a *trigger*. Inserting one likely shows a message in the UI that
never runs. Left as an opt-in, clearly-labeled experiment
(`UNSAFE_DB_WRITE=1` → `DbQueueActuator`, currently a stub) to be validated
only by live observation, since it risks racing the app's writer.

### ✓ macOS Accessibility (AppleScript) — the viable path, shipped as default
`AppleScriptActuator` activates Conductor and pastes+sends the prompt via
System Events. It drives the app's **real** send path — no injection, no DB
poking, works on the hardened build (Accessibility is an OS permission the user
grants once). Coupling is to the prompt field, not the frontend bundle, so it
survives UI-bundle updates.
- **Known gap:** it types into whichever session Conductor currently has
  focused. Reliable **per-workspace targeting** needs either an AX-tree map of
  the sidebar rows or a `conductor://` deep-link route to focus a workspace
  (the scheme is registered — `CFBundleURLSchemes = [conductor]`,
  `tauri-plugin-deep-link` — but its routes are unmapped). That is the next
  recon step. Until then, treat writes as "send to the front workspace."

### ✓ Alternative: drive Claude Code directly (not wired)
Because `sessions.id == claude_session_id` and the worktree is a normal repo,
`claude --resume <id> -p "<prompt>"` from the relay would run the turn with zero
Conductor coupling. Trade-off: a second agent operating the same session/tree
can conflict with Conductor's own management and its UI won't reflect the turn
until it re-reads. Noted as a fallback, not the default.

---

## The two "unknowns to test first" from the plan — answered
- **CSP / outbound ws from the webview:** moot. The new architecture never
  injects anything into the webview, so there is no in-webview socket to permit.
- **Injection persistence across updates:** moot for the same reason. The only
  update-fragile surface is the AX prompt-field target, remapped in minutes.

## Suggested next steps
1. Map the write target: bring a workspace to front, inspect Conductor's AX tree
   (Accessibility Inspector) for the prompt `textarea`, and/or probe
   `conductor://` deep-link routes → upgrade `AppleScriptActuator` to focus a
   specific workspace before typing.
2. Optionally spike the `claude --resume` actuator behind a flag and compare UX.
3. File the Help ▸ Send Feedback request for a **local** control API — if
   Conductor exposes the existing `/v0` surface against local workspaces, the
   whole write path collapses to a supported call.
