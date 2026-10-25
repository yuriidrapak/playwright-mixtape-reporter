# Development

[README](../README.md) · [Usage](usage.md) · [Releasing](releasing.md)

Use `.nvmrc` (Node 24.22.1) and npm 11.19 or newer. This is a standalone repository.
Run `nvm install` and `nvm use` to select the pinned runtime. Other supported
lines start at Node 22.23.4 and 26.12.1; review new security releases regularly.

```sh
npm run security
npm ci --ignore-scripts
npm run check
npm run demo -- --workers=10
```

Dependencies are pinned in `package.json` and `package-lock.json`. `.npmrc` blocks
install scripts and filters new releases for seven days. `npm run security` checks
the lockfile, toolchain, and effective npm script/registry/exact-save/release-age
settings before installing. Environment or duplicate-key overrides cannot silently
weaken those checks. Only these non-secret values are queried; full npm config
is never dumped. Explicit npm commands such as
`npm test` still execute their named scripts. Build with `npm run build`; it removes
stale output before emitting native ESM and declarations. Published consumers
need no compiler. Development tests use Node's built-in TypeScript stripping;
keep TypeScript syntax erasable (no enums or parameter properties).

Run `npm run security` without npm CLI overrides. npm does not propagate
`--min-release-age` CLI flags to scripts, so the check validates the persisted
and inherited configuration, not a hidden flag on the parent command. CI uses
`npm ci --ignore-scripts --min-release-age=7` explicitly. A successful check
cannot prevent someone overriding policy in a separate later install command.

## Source layout

Paths below are relative to this repository root.

| File                      | Responsibility                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`            | Public reporter class, Playwright callbacks, labels, diagnostics, and final outcomes.                           |
| `src/options.ts`          | Public options type, defaults, environment precedence, and animation eligibility.                               |
| `src/terminal.ts`         | Output, status markers, compact startup heading, retained-panel insertion, cell updates, and lifecycle cleanup. |
| `src/layout.ts`           | ANSI-aware display widths, wrapping, truncation, and styled cell patches.                                       |
| `src/colors.ts`           | Fixed palette and semantic status colors.                                                                       |
| `src/workers.ts`          | Logical worker slots, attempt state, progress, and concurrency measurements.                                    |
| `src/status-header.ts`    | One-line RUN activity, CPU, network, and elapsed-time fields with width-aware fallbacks.                        |
| `src/controls.ts`         | Optional TTY keyboard ownership, runner selection, inspection, display hold, and input cleanup.                 |
| `src/worker-panel.ts`     | Responsive runner lanes and compact worker chips.                                                               |
| `src/metrics.ts`          | Optional worker fixture: Node HTTP socket counters and browser request-size observers.                          |
| `src/metrics-monitor.ts`  | Total system CPU deltas, private network snapshots, combined worker byte rates, and stale-sample handling.      |
| `src/resource-display.ts` | Time-based CPU/network damping and traffic history; independent of raw rate collection.                         |
| `src/summary.ts`          | Responsive final mix, pass-rate bar, diagnostics links, and compact summary.                                    |
| `src/diagnostics.ts`      | Atomic failed/flaky log, attempt output, attachments, and trace links.                                          |
| `src/format.ts`           | Shared duration formatting and plain diagnostic text.                                                           |
| `demo.mjs`                | Simulated events for interactive previews without application access.                                           |

The build emits native ESM JavaScript and declarations in `dist/`. Keep runtime
dependencies at zero and use type-only Playwright imports for reporter types.
Keep lane colors tied to execution state, and drive progress from actual events.

### Rendering contract

Keep final-summary badges fixed-width and independent of emoji width settings.
Every framed row must have the same display-cell width as its edges. Shorten
long visible log paths by directory components, preserve the filename where it
fits, and retain the complete hyperlink target. Wrap failure titles, source
locations, and preformatted error/stack lines with hanging indentation.

Keep completed results in the normal scrollback buffer and the live panel below
them. Insert new results above the retained panel rather than clearing it on
each completion. Animation ticks must patch changed cells while preserving
unchanged text, styles, grapheme clusters, and display-cell alignment. Insert
multi-line diagnostics in batches bounded by the space outside the panel.

Finished attempts must leave the live table once listed. Retry waiting and idle
slots have stationary reels, blank attempt labels, and `--:--` timing. The
attempt column stays available after the first retry starts, keeping the table
layout stable. Each new attempt gets its own activity ramp.

Keep worker activity, resource meters, and elapsed time in one status line.
Reduce graph widths before shortening labels or dropping entire optional fields;
never wrap a field or clip a number. Preserve the per-slot handoff delay and
smooth ramp from `LiveRun.loadFor`, independently of CPU and network samples.
Network values share a decimal Mbit/s unit with two decimal places. CPU uses the
total system 0–100% scale. Ease resources with elapsed time, keep system CPU live
between tests, and count all worker byte deltas once per shared window.

Claim stdin only for interactive animations on an unclaimed TTY. Keep input
parsing isolated from the real stream, release listeners and raw mode on exit,
and forward Ctrl+C through the normal interruption path. Selection and details
must follow logical slots, clear completed titles, and fit in the height budget.
Display hold suspends periodic redraws while tests and result output continue.
Keep hints below the frame and maintain space for scrollback insertion.

Keep one full-width worker row and a single table heading on wide terminals.
Increasing the width must not regroup workers into side-by-side tables or
shorten titles that fit in the available row. Use compact chips when the full
table cannot fit vertically or the terminal is too narrow for readable titles.

Use one unreferenced 120 ms timer, skip animation frames under stdout
backpressure, and pause while a forwarded log line is incomplete. Commit resize
recovery and oversized-output redraws immediately with their output. Stop the
timer, remove the panel, and restore the cursor before the final summary and on
reporter exit.

## Verification

```sh
npm run check           # security policy, lint, formatting, types, tests, tarball
npx --no-install playwright install chromium
npm run test:browser    # real local HTTP + Chromium + retained traces + metrics
npm run bench           # synthetic render/diff timings, no browser or credentials
npm audit --audit-level=high
npm run pack
npm run test:package -- ./playwright-mixtape-reporter-1.0.1.tgz
```

`npm test` and `npm run typecheck` build first, so package self-references work in
a fresh checkout without existing declarations. Tests cover terminal output, Unicode widths, retries,
expected failures, interruptions, sharding, blob merges, diagnostic errors,
streamed control-sequence filtering, file permissions, metrics teardown, and
malicious/malformed archive and dependency-policy fixtures. Secret fixtures are
synthetic; do not read real credentials to exercise the scanner.
The ten-worker pseudo-terminal test requires the POSIX `script` utility and is
skipped on Windows. HTTP tests bind only to loopback. Sandboxed environments may
need to allow local server binding and pseudo-terminals.

`npm run pack` builds and inspects an archive; bare `npm pack` does neither
validation nor building because this project has no lifecycle hooks.
`npm run test:package` expects a current build. Without a path it creates a temporary
tarball; with a path it verifies those exact bytes against the workspace build.
It checks the archive inventory and content, installs into a consumer **outside**
this repository, and
checks public imports, TypeScript declarations, both Playwright config formats,
and actual execution. It seeds the consumer with the reviewed dependency lockfile
and reuses tarballs from the npm cache populated by `npm ci`; use the same cache
setting for both commands. npm may fetch registry metadata for peer/age checks.
The resulting dependency identities and integrity must still match the reviewed
lockfile before any installed code executes. This catches mistakes
that source imports and monorepo symlinks can conceal.

CI checks the exact Node 22.23.4 minimum, current Node 22/24/26 lines, and Node 24
on macOS and Windows. Chromium has a separate Linux smoke job. These jobs must
pass in GitHub before the first release; local macOS validation alone does not
prove the other platforms.

## Style and review

Use `npm run format` for Prettier and `npm run lint` for Oxlint. TypeScript strict
checks include unchecked indexes, optional properties, unused variables and
parameters, return paths, and switch fallthrough. Keep lint suppressions narrow
and explained; Playwright's empty fixture destructuring is intentional.

The reporter entry point uses only Node built-ins at runtime. Only the optional
`/metrics` export loads the existing `@playwright/test` peer. Avoid adding runtime
dependencies unless their benefit justifies the cost and maintenance.

Update the usage reference and regression tests when changing observable
behavior. For terminal changes, preview six and ten workers, resize the terminal,
and confirm completed results stay in scrollback and the cursor returns on exit.
The benchmark reports rendering cost separately from terminal I/O; compare on
the same machine and runtime. Do not treat its numbers as end-to-end overhead.

See [performance](performance.md) for budgets and benchmark interpretation,
[supply-chain security](supply-chain-security.md) for update policy and incident
analysis, and [releasing](releasing.md) for exact-artifact publication. Agent and
maintainer invariants are recorded in [AGENTS.md](../AGENTS.md).
