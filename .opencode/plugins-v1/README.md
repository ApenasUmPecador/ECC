# ECC V1 plugin (quarantined)

- `ecc-hooks.ts` is the adapted V1 implementation loaded by the V2 adapter.
- `ecc-hooks.original.ts` is the untouched installed V1 file and is never imported.
- `lib/changed-files-store.ts` is shared by the V1 plugin and the V2 `changed-files` tool.
- V1 cannot run on OpenCode V2; the pristine copy exists only for comparison and upstream updates.
- Rollback steps are in section 13 of `docs/specs/2026-10-30-opencode-v2-port-design.md` and use the backup set in `.backups/20261030-v2-port/`.

## Verification record — 2026-11-03

- Primary command exit codes (read-only, command-generator, write/tracking, hook-failure): 0, 0, 0, 0.
- Additional command exit codes (repeat, real config, rollback): 0, 0, 0.
- `failed to load plugin` count: 0 in every run.
- Hook failure isolation: an injected `shell.env` failure was logged as `hook shell.env failed`; the shell command still executed. The adapted V1 file was restored and verified byte-identical with `cmp`.
- Rollback: with `plugins/index.ts` moved aside there were 0 load errors and ECC was off. The entrypoint was restored and `plugins/` contains only `index.ts` at the top level.

## Final review smoke — 2026-11-03

- `opencode plugin list` shows `ecc.hooks local ~/.config/opencode/plugins/index.ts` and `superpowers`; there are no ECC file entries.
- Shell env: a real `opencode run` shell call returned `true` for `echo $ECC_PLUGIN`.
- Permission: a real V2 server session with `permissions:[{action:"shell",resource:"*",effect:"ask"}]` auto-approved `npx prettier --version`; the ECC log recorded `Permission requested for: bash` and `Auto-approved formatter: npx prettier --version`. No permission request remained pending and the command ran.
- Compaction: waived on OpenCode 2.0.32 — compaction could not be triggered safely in this environment; the adapter's system-block construction remains covered by unit tests.
- Final fixes: cleanup awaits the aborted event loop with a 2-second bound; `session.moved` is logged; the V1 tool map is removed without mutating the hook record; partial hook registrations are disposed if the second registration fails.
- Post-fix re-run (after the fix wave): same results — `echo $ECC_PLUGIN` → `true`; `npx prettier --version` auto-approved (log 2026-11-03T21:07:34Z) with no pending request; a plain `echo permission-probe` under `shell: ask` still produced a permission request (not auto-approved); `opencode plugin list` unchanged; 0 load errors; 60/60 tests; load/unload lines balanced.
