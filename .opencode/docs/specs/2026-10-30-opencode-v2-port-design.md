# ECC OpenCode V2 Local Port — Design

- Date: 2026-10-30
- Status: Approved 2026-10-30
- Scope: `~/.config/opencode` on this machine
- Target: OpenCode 2.0.32, ECC 2.2.3
- Design author: OpenCode session

## 1. Intent

Make ECC's OpenCode integration work again on OpenCode V2 without waiting for an
upstream release.

ECC 2.2.3 ships a V1 plugin. OpenCode 2.0.32 rejects it on every startup, so all
ECC hooks and tools are dead. There is no merged upstream fix and no published
V2-compatible ECC release. This design is a local port that keeps ECC's existing
hook logic and restores its tools on the V2 plugin API.

The user chose the full local V2 port over disabling the plugin, applying the
partial PR #3635, or leaving it broken.

## 2. Why now

Current startup failures on every OpenCode run:

| Target | Error |
| --- | --- |
| `~/.config/opencode/plugins/ecc-hooks.ts` | `Cannot find package '@opencode-ai/plugin' imported from tools/changed-files.ts` |
| `~/.config/opencode/plugins/index.ts` | `Plugin must export a default definition with an id and an effect or setup function` |
| `~/.config/opencode/plugins` (from `plugin: ["./plugins"]`) | Same V1 export rejection |

Two independent faults:

1. ECC's plugin is a V1 bare function. V2 requires a default export shaped
   `{ id, setup(ctx) }` or `{ id, effect }`. V1 implementations are explicitly
   unsupported in V2.
2. The V1 tools import `@opencode-ai/plugin/tool` at runtime, but ECC was
   installed by copying files, not by npm, so that package is absent.

Installing `@opencode-ai/plugin` would not fix the first fault. It is the V1 SDK
(latest 1.19.5); V2 uses `@opencode/plugin` (latest 2.2.4).

Upstream evidence:

- Open issues: #3810, #3745, #3668, #3625, #3626, #3537.
- PRs #3536 (closed), #3635 (open, partial), #3676 (open, changes requested),
  #3224/#3617 (conflicting), #3660 (closed). None merged.
- `ecc-universal` npm `latest` is still 2.2.3 with the V1 code.

## 3. Goals

- One local V2 plugin that loads cleanly on OpenCode 2.0.32 with no ECC load
  warnings.
- Restore every mappable ECC hook: tool before/after, shell env, permission,
  compaction, session lifecycle, file tracking, skill telemetry.
- Restore all eight ECC tools as direct V2 tools:
  `run-tests`, `check-coverage`, `security-audit`, `format-code`, `lint-check`,
  `git-summary`, `changed-files`, `dependency-analyzer`.
- Keep ECC skills, commands, agents, prompts, and instructions unchanged.
- Preserve a pristine V1 implementation on disk for comparison and rollback.
- Add no npm dependencies and no `node_modules` shim.

## 4. Non-goals

- Changing upstream ECC or opening a PR.
- Supporting OpenCode V1 and V2 from the same entrypoint.
- Exact parity for hooks V2 removed or does not deliver reliably.
- Fixing ECC's installer or its packaging bug.
- Changing ECC hook-profile semantics, thresholds, or command allowlists.

## 5. Anti-goals

- Do not install `@opencode-ai/plugin` to paper over the import error.
- Do not leave a top-level `plugins/ecc-hooks.ts`; V2 auto-discovers it and it
  would keep failing and double-load.
- Do not silently drop a hook without recording it in this document.
- Do not let an ECC hook failure block a tool call, a session, or startup.
- Do not turn a V2 `deny` into anything else. Configured deny rules are final in
  V2 and never reach the permission hook.
- Do not auto-approve a compound shell command, and do not join permission
  resources to make a command look safe.
- Do not log prompt text, tool output, environment values, or secrets.

## 6. Constraints

- V2 loads direct `.ts`/`.js` files in `~/.config/opencode/plugins/`. Only
  `plugins/index.ts` may sit at that level. Helpers belong in subdirectories.
- A configured plugin path must be a directory. Remove the old
  `plugin: ["./plugins"]` entry so the directory is not loaded twice.
- The plugin can be framework-free. Verified on 2.0.32: a plain
  `export default { id, setup(ctx) }` loads and runs without `@opencode/plugin`.
- V2 hook payloads and mutation behavior were verified by throwaway probes in
  `/tmp/opencode/probe`; see section 8.
- `ctx.tool.transform` replays its callback onto a fresh registry. Tool
  registration must be a repeatable pure transform (section 9.5).
- V2 event delivery is incomplete in headless runs: `session.created`,
  `session.idle`, `session.deleted`, and `filesystem.changed` did not arrive.
  Core behavior must not depend on them.
- V2 action names differ from V1: `shell` not `bash`, `edit` covers writes,
  `subagent` not `task`. V2 tool inputs use `path`, not `filePath`.
- ECC root discovery walks ancestors and still works from `plugins-v1/`, because
  that directory remains under `~/.config/opencode`.
- This machine is Linux; shell-shim quoting is POSIX. Windows behavior is
  documented as untested.

## 7. Approaches considered

### A. Disable ECC's plugin layer

Move the V1 files out of discovery and drop the plugin key. Clean logs, zero
risk, but loses all hooks and tools. Rejected because the user chose parity.

### B. Apply PR #3635

An open, mergeable adapter. It drops `permission.ask`, `shell.env`, compaction,
session events, and both custom tools. It is unreviewed third-party code with
shell access. Rejected as both incomplete and riskier than a reviewed local
port.

### C. Full local V2 port (chosen)

Two sub-approaches:

- **C1: Rewrite every hook from scratch.** Cleanest long-term, but reimplements
  811 lines of tested ECC logic and invites behavioral drift.
- **C2: Adapter around the preserved V1 implementation (chosen).** Move the V1
  file to `plugins-v1/`, remove its runtime tool imports, call it with a
  synthetic V1 context, and map its returned hooks onto V2 domains. Port the
  tools separately because their V1 wrapper is what pulls in the missing
  package.

C2 preserves ECC's hook logic and profile gates while keeping the V2-specific
code small and auditable.

## 8. Verified V2 behavior

Probe results on OpenCode 2.0.32, using `/tmp/opencode/probe`. The probe plugin
was loaded through the V2 `plugins` key and exercised a real `opencode run`.

| Area | Result |
| --- | --- |
| `setup(ctx)` | Runs once per location; `ctx.location.directory` is that location's root. `ctx` exposes `app`, `location`, `tool`, `shell`, `permission`, `session`, `event`, `storage`, and other domains. |
| Location scope | Docs: `ctx.location` is "the plugin instance's location, not the location of every session it can access or event it receives." A separate location gets a separate plugin instance. Events carry `event.location.directory`. |
| `tool.execute.before` | Payload `{ tool, sessionID, agent, messageID, id, input }`. Mutating `input.input` changes the real call; the permission check sees the mutated input. |
| `tool.execute.after` | Payload adds `status` and `result` (or `error`). Mutating `result.content[0].text` changes what the model sees. `result.content` is an array of `{ type: "text", text }`. |
| `shell.create.before` | Payload `{ command, cwd, timeout, shell, env }`. Mutating `env` reaches the executed command. Verified with `PROBE_ENV=probe-env-applied`. |
| `permission.evaluate` | Payload `{ sessionID, agent, action, resources, metadata, source, effect, message }`. Effects are `allow`, `ask`, `deny`. Hooks run for `allow` and `ask`; an explicit configured `deny` is final and does not invoke the hook. A hook may set `allow`, `ask`, or `deny`. |
| `session.context` | Fires before every model request and exposes `{ sessionID, agent, model, system, messages, tools }`. Reliable first-sight session hook. |
| `session.experimental.idle` | Registers successfully, but did not fire in a headless `opencode run`. Secondary only. |
| `session.execution.succeeded` | Fired once per headless run with `{ sessionID }` and a location. Reliable fallback for the session-idle audit. |
| `event.subscribe` | `types` filter was ignored on 2.0.32; lifecycle/file events did not arrive in headless runs. `signal` exists in `SubscribeOptions`. Filter manually and treat file/lifecycle events as best-effort. |
| `session.hook("compaction")` | Registers; not triggered in the probe. Shape from the SDK: mutable `system` parts, `messages`, `tools`, and optional `result`. |
| `tool.transform` | Callback is synchronous and replayed onto a fresh registry. Three observed runs each started with the 20 built-in tools. `editor.add` of the same name twice in one callback is allowed; the later definition wins. |
| Tool registration | `editor.get(id)` sees a tool added earlier in the same callback. `ctx.tool.list()` after the transform sees it. `options: { codemode: false }` exposes a tool directly. Hyphenated names work directly. |
| Tool inputs | `write`/`edit`: `{ path, ... }`; `shell`: `{ command, ... }`; `read`: `{ path }`; `patch`: `{ patchText }`. Permission actions: `read`, `edit`, `shell`. |

## 9. Design

### 9.1 File layout

```text
~/.config/opencode/
├── opencode.json                      # remove "plugin": ["./plugins"]
├── plugins/
│   ├── index.ts                       # V2 entrypoint, only top-level plugin file
│   └── lib/
│       ├── bridge.ts                  # synthetic V1 context + hook caller
│       ├── events.ts                  # event subscription, idle dedupe, cleanup
│       ├── hooks.ts                   # V2 hook registrations and mapping
│       ├── log.ts                     # file logger and rotation
│       ├── mapping.ts                  # pure tool/permission/patch mapping
│       ├── shell.ts                   # tagged-template $ shim
│       ├── tests/                     # non-loaded Node tests
│       └── tools/
│           ├── types.ts               # framework-free ToolDefinition type
│           ├── index.ts               # async createTools(cwd)
│           ├── changed-files.ts
│           ├── dependency-analyzer.ts
│           ├── run-tests.ts
│           ├── check-coverage.ts
│           ├── security-audit.ts
│           ├── format-code.ts
│           ├── lint-check.ts
│           └── git-summary.ts
├── plugins-v1/
│   ├── README.md                      # what is loaded, what is reference-only
│   ├── ecc-hooks.ts                   # adapted V1 implementation (loaded)
│   ├── ecc-hooks.original.ts          # pristine V1 copy (never imported)
│   └── lib/
│       └── changed-files-store.ts     # moved with the V1 file
└── tools/                             # untouched V1 tools; inert on V2
```

`plugins-v1/ecc-hooks.ts` keeps its dynamic import
`./lib/changed-files-store.ts`, so the store moves with it. The V2
`changed-files` tool imports the same file by absolute-resolved path so both
share one module instance.

`ecc-hooks.original.ts` is an exact copy of the installed V1 file. Its relative
imports still resolve because it sits at the same directory depth as the
original. It is reference-only: nothing imports it, and V2 does not scan
`plugins-v1/`.

The original `tools/` directory is left untouched. V2 does not load it, which is
why it produces no tool-registration errors. It remains available for rollback
and for comparison while porting.

### 9.2 V2 entrypoint

`plugins/index.ts` default-exports:

```ts
export default {
  id: "ecc.hooks",
  async setup(ctx) {
    // build the V1 context, call the V1 plugin, map its hooks
    return cleanup
  },
}
```

`setup` must:

1. Build the logger and shell shim from `ctx.location.directory`.
2. Dynamically import `../plugins-v1/ecc-hooks.ts` inside `try/catch`, so a
   missing or broken V1 file cannot abort Startup.
3. Call `ECCHooksPlugin` from that module with the synthetic V1 context.
4. Dynamically import `./lib/tools/index.ts` and build the available tools in
   `try/catch`.
5. Register each V2 domain in its own `try/catch`, so one missing domain does
   not abort the rest.
6. Log one `[ECC] V2 plugin loaded` line with counts of hooks and tools.
7. Return cleanup that disposes registrations, aborts the event loop, clears
   session state, and logs one unload line.

It must not statically import `@opencode/plugin`, `@opencode-ai/plugin`, any ECC
`tools/` module, or `plugins-v1/`.

### 9.3 V1 bridge

`plugins/lib/bridge.ts` builds this synthetic `PluginInput`:

- `client.app.log({ body })`: append to the ECC log file; mirror `warn` and
  `error` to `console.error`. Never throw.
- `$`: tagged-template shell from `plugins/lib/shell.ts`, executed with
  `cwd = ctx.location.directory`. It supports `await $\`...\`` and
  `await $\`...\`.text()`, throws on non-zero exit, and exposes `stdout` on the
  error so ECC's `tsc` handler can read it.
- `directory`: `ctx.location.directory`.
- `worktree`: `ctx.location.directory`. V2 has no separate worktree field on
  this context; the location directory is the project root in the tested layout.
- `project`: `ctx.location.project` (not consumed by the current V1 file).

The bridge calls V1 hooks through a safe wrapper:

```ts
async function callHook(name, ...args) {
  const fn = hooks[name]
  if (typeof fn !== "function") return undefined
  try {
    return await fn(...args)
  } catch (error) {
    log.error(`hook ${name} failed`, error)
  }
}
```

A V1 hook error must never abort a tool call or session.

### 9.4 Hook mapping

| V1 hook | V2 registration | Adapter behavior |
| --- | --- | --- |
| `tool.execute.before` | `ctx.tool.hook("execute.before")` | Map V2 tool/input to V1 `{ tool, sessionID, callID, args }`. Call V1. Copy recognized argument mutations back to `event.input` (`path`, `command`, `content`). For `patch`, parse affected paths and record existence per call. |
| `tool.execute.after` | `ctx.tool.hook("execute.after")` | Synthesize `file.edited` for edit/write/patch paths **first**, then call V1 `tool.execute.after` so a new file's `added` marker wins over the synthesized `modified` marker. |
| `file.edited` | No V2 hook | Invoked by the adapter after edit/write/patch. Preserves prettier (strict), console.log warning (standard/strict), edited-file tracking, and change recording. |
| `file.watcher.updated` | `ctx.event.subscribe()` → `filesystem.changed` | Best-effort map `{ file, event }` to `{ path, type }`: `add`→`added`, `change`→`modified`, `unlink`→`deleted`. Not relied on; headless runs did not deliver it. |
| `session.created` | `ctx.session.hook("context")` first sight of `sessionID`; also event if it arrives | Run once per session per plugin instance. Reliable because `context` fires on every model request. |
| `session.idle` | `session.execution.succeeded` event primary; `session.experimental.idle` secondary; `session.idle` event if it arrives | Run the V1 audit once per session execution. Deduplicate with a short per-session window so two signals do not double-run. |
| `session.deleted` | `ctx.event.subscribe()` → `session.deleted`; cleanup on unload | Best-effort; cleanup always runs on plugin unload. |
| `todo.updated` | None | Dropped. V2 has no equivalent. Log a one-time debug note. |
| `shell.env` | `ctx.shell.hook("create.before")` | Copy `event.env`, call V1 with `{ cwd }` and `{ env }`, then assign the result back to `event.env`. Verified mutation reaches the command. Log variable names only, never values. |
| `experimental.session.compacting` | `ctx.session.hook("compaction")` | Call V1 with `{ sessionID }` and `{ context: [], prompt: undefined }`. Push each returned context string into `event.system` as `{ type: "text", text }`. If V1 returns a prompt string, append it as a final text part. |
| `permission.ask` | `ctx.permission.hook("evaluate")` | Map action/resources to V1 `{ tool, args }`. Approve only when every resource independently passes ECC's rule. Set `allow` only when the current effect is `ask`. Never change `deny`. |
| `tool` map | `ctx.tool.transform` | Register all eight ported tools. No guard; the transform is replayed onto a fresh registry. Set `options: { codemode: false }`. |

#### Per-location behavior

V2 loads a separate plugin instance per location. Tools capture
`ctx.location.directory` from their own instance, so two open projects do not
share a `cwd`. Event handlers ignore events whose
`event.location.directory` is present and does not match the instance
directory. Session-scoped hooks (`context`, `compaction`) are registered by the
instance for that location.

A session can be moved to another location (`session.moved`). The destination
location gets its own plugin instance. ECC's captured V1 state (`worktreePath`,
edited-file set) is not re-homed in the old instance; the adapter logs
`session.moved` best-effort and leaves path resolution to the destination
instance. If OpenCode keeps routing a moved session through the old instance,
ECC path resolution remains at the old root until the plugin reloads. This is a
documented limitation, not a correctness promise.

#### Tool name mapping

| V2 tool | V1 tool | Input mapping |
| --- | --- | --- |
| `shell` | `bash` | `input.command` |
| `edit` | `edit` | `input.path` → `args.filePath`, keep other fields |
| `write` | `write` | `input.path` → `args.filePath`, keep content |
| `patch` | `patch` | Parse `*** Add File:`, `*** Update File:`, `*** Delete File:`, and optional `*** Move to:` lines. |
| `read` | `read` | `input.path` |
| `skill` | `skill` | Pass input through |
| other | same | Pass input through |

The V1 hook reads `args.filePath`, `args.file_path`, or `args.path`, and calls
`args.toString()` in its shell checks. The adapter therefore passes an object,
not a bare string:

```ts
const args = {
  ...input,
  filePath: input.path ?? input.filePath,
  command: input.command,
  toString() {
    return this.command ?? this.filePath ?? this.path ?? ""
  },
}
```

This makes ECC's PR-created, git-push, and long-running-command checks work on
V2, where they were effectively `[object Object]` before.

#### Permission action mapping

| V2 action | V1 tool |
| --- | --- |
| `shell` | `bash` |
| `read` | `read` |
| `edit` | `edit` |
| `subagent` | `task` |
| other | same string |

Rules:

- Evaluate each resource separately. Never join resources with `&&` or any other
  separator.
- For `shell`, an empty resource list is not auto-approved.
- For `read`, V1's rule is unconditional. Apply it to every read resource,
  including `.env` and key files. This is exact V1 parity, chosen explicitly by
  the user; it is not a broadening of ECC's policy.
- If V1 returns `approved: true` and the current effect is `ask`, set `allow`.
- If V1 returns `approved: undefined`, or any resource fails, leave `effect`
  unchanged.
- If V1 returns `approved: false`, log it and leave `effect` unchanged. V1 only
  returns false on an internal error; translating that into a V2 `deny` would
  block work on a bug.
- If V1 throws, leave `effect` unchanged and log. V2's own rules remain
  authoritative.

#### Shell auto-approval hardening

ECC's V1 regexes are anchored only at the start, so `prettier --write x && curl
evil` would match. The port keeps ECC's formatter and test allowlist but adds a
guard: every shell resource must match the allowlist in full and contain no
shell control operators (`;`, `&&`, `||`, `|`, backtick, `$(`, `>`, `<`,
newline). A compound command is never auto-approved. This only narrows ECC's
auto-approval; it never broadens it.

### 9.5 Tool port and registration

All eight tools live in `plugins/lib/tools/` and are created by
`async createTools(cwd)`. Each module exports `create(cwd): ToolDefinition`:

```ts
{
  name: "changed-files",
  description: "...",
  input: { type: "object", properties: { ... }, additionalProperties: false },
  options: { codemode: false },
  execute: async (input) => ({ content: JSON.stringify(result) }),
}
```

`cwd` is captured at setup from `ctx.location.directory`; V2 tool context does
not expose `worktree` or `directory`.

`createTools` dynamically imports each tool module inside `Promise.allSettled`,
so one broken tool file does not prevent the other seven from registering. It
returns the successful definitions and a list of load errors for the logger.

Tool inputs:

| Tool | Input schema |
| --- | --- |
| `run-tests` | `pattern?: string`, `coverage?: boolean`, `watch?: boolean`, `updateSnapshots?: boolean` |
| `check-coverage` | `threshold?: number`, `showUncovered?: boolean`, `format?: "summary" \| "detailed" \| "json"` |
| `security-audit` | `type?: "all" \| "dependencies" \| "secrets" \| "code"`, `fix?: boolean`, `severity?: "low" \| "moderate" \| "high" \| "critical"` |
| `format-code` | `filePath: string`, `formatter?: "biome" \| "prettier" \| "black" \| "gofmt" \| "rustfmt" \| "swift-format"` |
| `lint-check` | `target?: string`, `fix?: boolean`, `linter?: "biome" \| "eslint" \| "ruff" \| "pylint" \| "golangci-lint"` |
| `git-summary` | `depth?: number`, `includeDiff?: boolean`, `baseBranch?: string` |
| `changed-files` | `filter?: "all" \| "added" \| "modified" \| "deleted"`, `format?: "tree" \| "json"` |
| `dependency-analyzer` | `type?: "all" \| "outdated" \| "security" \| "unused"`, `fix?: boolean`, `depth?: number` |

Behavior is copied from the V1 files, including their safety checks
(`git-summary` ref validation, `security-audit` secret-scanning exclusions,
`format-code`/`lint-check` platform command generation). V1 returns strings;
V2 returns `{ content: string }`.

`changed-files` imports the shared store from
`../../../plugins-v1/lib/changed-files-store.ts`. The resolved module is the
same one the V1 plugin dynamically imports, so change tracking is shared.

Registration:

```ts
const tools = await createTools(cwd)
await ctx.tool.transform((editor) => {
  for (const tool of tools) editor.add(tool)
})
```

**No idempotency guard.** Docs and probe agree: every registry rebuild replays
the transform onto a fresh base (20 built-ins), and a later registration with
the same effective name overrides the earlier one. Three observed replays each
started at 20 tools, re-adding produced 21, and `ctx.tool.list()` showed no
duplicates. A module-level `Set` or `editor.list()` guard would skip registration
on a fresh replay and break `ctx.tool.reload()`. The transform must stay
synchronous and repeatable; load the tools before registering.

### 9.6 Configuration

Change `~/.config/opencode/opencode.json`:

- Remove the deprecated `"plugin": ["./plugins"]` entry.
- Keep `"plugins": ["superpowers@git+https://github.com/obra/superpowers.git"]`.
- Keep ECC `skills.paths`, agents, and instructions unchanged.

Do not add the `plugins` directory to the config; it is auto-discovered. Adding
it back causes double-loading.

A timestamped backup of the current config already exists:
`opencode.json.bak-20261030-150059`.

### 9.7 Logging

`plugins/lib/log.ts` appends to `~/.config/opencode/logs/ecc-hooks.log`:

- Create the directory lazily with owner-only permissions.
- Rotate to `ecc-hooks.log.1` when the file exceeds 1 MiB.
- Write all levels to the file; mirror `warn` and `error` to `console.error`.
- Use synchronous appends for short, atomic lines.
- Never log prompt text, tool output, env values, file contents, or secrets.
- Log setup, registration failures, hook failures, and tool errors only.

### 9.8 Error handling

- Every V2 registration is wrapped; failures are logged and skipped.
- Every V1 hook call is wrapped; failures are logged and swallowed.
- Tool execution errors return
  `{ content: JSON.stringify({ success: false, error }) }` rather than crashing
  the session.
- If the changed-files store cannot load, change tracking disables itself and
  logs one warning; all other hooks continue.
- If the event loop fails, log once and continue; no core behavior depends on
  it.
- If the V1 plugin or tool factory fails to import, log once and start the
  plugin with the remaining capability (hooks or tools) instead of failing
  OpenCode.

### 9.9 Cleanup

The setup cleanup must:

- Dispose all hook and transform registrations with `Promise.allSettled` and
  per-registration catch.
- Abort the event subscription with its `AbortController`, then await the loop
  with a 2-second timeout.
- Clear `seenSessions`, the idle dedupe map, and any adapter-side pending patch
  state.
- Call the V1 `session.deleted` hook once to clear its edited-file set,
  pending changes, and shared store.
- Log `[ECC] V2 plugin unloaded` and never throw.

## 10. Lost or degraded behavior

| Behavior | Status | Mitigation |
| --- | --- | --- |
| `todo.updated` progress logging | Lost | No V2 equivalent; documented. |
| `session.idle` console.log audit/notification | Restored via `session.execution.succeeded` | Primary event fired in every headless run; `experimental.idle` is a secondary signal with dedupe. |
| `session.created` event | Replaced | First `session.context` call is the reliable trigger. |
| `session.deleted` event | Best-effort | Event plus cleanup on unload. |
| `filesystem.changed` external edits | Best-effort | Tool hooks cover agent edits; external edits may not be tracked. |
| `file.edited` exact timing | Replaced | Runs after edit/write/patch completion; same formatting and warning behavior. |
| Permission deny override | Not possible | V2 evaluates configured deny first and skips the hook. |
| `permission.ask` auto-approve | Conditional | Relaxes `ask` to `allow` only for ECC's rules; never touches deny. |
| Sessions moved between locations | Partial | Destination plugin instance owns the new location; old captured state is not re-homed. |
| Cross-session edited-file buffer | Shared per location | Matches V1; cleared on `session.deleted`/unload. Documented, not rewritten. |
| Windows shell shim | Untested | Target is Linux; POSIX quoting only. |

## 11. Security

- No new dependencies, `node_modules`, or network calls in the adapter.
- Shell shim uses `exec` with the project directory as `cwd`; values are
  single-quote escaped. It only runs ECC's own fixed commands (prettier, grep,
  tsc, notify-send) with paths from tool inputs.
- Tool inputs remain model-controlled; existing validation in
  `git-summary`/`security-audit` is preserved.
- Permission hook never changes `deny` and never joins resources.
- Read auto-approval preserves V1 exactly, including `.env` and key files, as
  explicitly chosen by the user. V2 configured `deny` remains final.
- Shell auto-approval rejects compound commands and requires every resource to
  match a full allowlist pattern.
- Logs exclude prompts, tool output, env values, file contents, and secrets.
- The V1 implementation is local, reviewed code already installed on this
  machine; the port only changes its entrypoint and tool registration.

## 12. Verification plan

Tests are local and dependency-free: Node 22
`--experimental-strip-types --test plugins/lib/tests/*.test.ts`.

1. **Unit tests (TDD)**
   - Tool input mapping for shell/edit/write/read/patch.
   - String-like `args.toString()` behavior.
   - Permission resource evaluation: single safe command, compound command,
     multiple resources, sensitive read path, undefined result.
   - Patch path/type parsing.
   - Compaction system-part construction.
   - Shell shim quoting and `.text()`.
2. **Startup cleanliness**
   - `opencode plugin list` shows one local `plugins/index.ts` entry and
     Superpowers; no ECC file entries.
   - `opencode run --standalone --print-logs "hello"` has zero
     `failed to load plugin` lines for ECC.
3. **Hook smoke test**
   - Shell env: run `echo $ECC_PLUGIN` and see `true`.
   - Permission: a shell command triggers `permission.evaluate`; the ECC log
     records it.
   - Tool before/after: edit and write a scratch file; `changed-files` sees it.
   - Idle audit: a session that edits a JS file with `console.log` logs the
     audit warning.
   - Compaction: trigger a compacted session if possible; verify the ECC context
     block appears in `system`.
4. **Tool smoke test**
   - Call each of the eight tools directly by name from a scratch session.
   - `changed-files` shows added/modified/deleted markers after edit/write/patch.
   - `git-summary` returns branch/status/log.
   - `run-tests`, `check-coverage`, `format-code`, `lint-check`,
     `security-audit`, `dependency-analyzer` return their documented JSON
     strings.
5. **Idempotency**
   - Trigger a tool registry rebuild/reload; verify no duplicate tool names and
     no duplicate hook effects.
   - Confirm `ctx.tool.list()` still shows exactly eight ECC tools plus
     built-ins.
6. **Regression**
   - Skills, commands, agents, and instructions still load.
   - Superpowers still loads.
7. **Logs**
   - `~/.config/opencode/logs/ecc-hooks.log` contains one load line and no
     repeated errors.
8. **Rollback check**
   - Move `plugins/index.ts` aside and restart; verify warnings stay gone and
     ECC tools/hooks are off.

## 13. Rollback

- **Disable the port:** move `plugins/index.ts` to `plugins-v1/index.ts` and
  restart. The V1 files are already outside discovery, so startup stays clean.
- **Restore the original config:** copy
  `opencode.json.bak-20261030-150059` back to `opencode.json`.
- **Restore V1 files:** copy `plugins-v1/ecc-hooks.original.ts` back to
  `plugins/ecc-hooks.ts` and `plugins-v1/lib/changed-files-store.ts` back to
  `plugins/lib/`, then restore `plugins/index.ts` from the preserved copy. Note
  that V1 still will not run on OpenCode V2; this only restores the pre-change
  state for upstream updates.

## 14. Decisions left to the builder

- Log rotation size (default 1 MiB) and whether to keep only `.1`.
- Exact shell allowlist regexes and control-operator guard wording.
- Whether to parse `*** Move to:` on day one; recommended, treated as
  delete-source plus add-destination.
- Whether to add the optional Node test harness; recommended, already included
  in the plan.
- Exact wording of the one-time dropped-`todo.updated` debug note.

## 15. Approval checklist

- [ ] Full local port, not disable/partial.
- [ ] Adapter around the preserved V1 implementation, not a from-scratch
      rewrite.
- [ ] All eight tools restored and registered directly.
- [ ] Pristine V1 copy kept at `plugins-v1/ecc-hooks.original.ts`.
- [ ] Deprecated `plugin` key removed; V2 auto-discovery only.
- [ ] Idempotency by repeatable transform replay; no registration guard.
- [ ] Documented degraded hooks accepted, including moved sessions.
- [x] **Permission policy:** preserve V1 exactly. `read` auto-approval applies
      to every read resource, including `.env` and key files. Configured `deny`
      is never touched. Chosen by the user on 2026-10-30.
- [x] **Design doc location:** `~/.config/opencode/docs/specs/` (not a git
      repository). Chosen by the user on 2026-10-30.
