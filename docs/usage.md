# Configuration and usage

[Package README](../README.md) · [Development guide](https://github.com/yuriidrapak/playwright-mixtape-reporter/blob/main/docs/development.md)

## Configuration reference

Pass options as the second item of the Playwright reporter tuple:

```ts
import { defineConfig } from '@playwright/test';
import type { MixtapeReporterOptions } from 'playwright-mixtape-reporter';

const terminal = {
  title: 'API + E2E / Mixtape',
  theme: 'cassette',
  colorMode: 'auto',
  animations: true,
  showLogs: false,
  symbols: 'emoji',
  includeSuiteTitles: false,
  printFailureDetails: true,
} satisfies MixtapeReporterOptions;

export default defineConfig({
  reporter: [
    ['playwright-mixtape-reporter', terminal],
    ['json', { outputFile: 'results/results.json' }],
    ['html', { open: 'never' }],
  ],
});
```

| Option                | Type                        | Default                                      | Behavior                                                                                            |
| --------------------- | --------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `title`               | `string`                    | `'Playwright Mixtape Reporter'`              | Heading above the run.                                                                              |
| `theme`               | `'cassette' \| 'compact'`   | `'cassette'`                                 | Retro ANSI colors and compact live worker deck, or the original static layout.                      |
| `colorMode`           | `'auto' \| 'color' \| 'bw'` | `'auto'`                                     | Detect ANSI color, force it on, or produce plain B&W output.                                        |
| `animations`          | `boolean`                   | `true`                                       | Request the live worker deck; terminal conditions below still apply.                                |
| `interactive`         | `boolean`                   | `true`                                       | Arrow-key selection, Enter inspection, and display hold on an unclaimed input TTY.                  |
| `showLogs`            | `boolean`                   | `false`                                      | Forward test stdout/stderr, including test `console.log` and `console.error`.                       |
| `showMetrics`         | `boolean`                   | `false`                                      | Add CPU and network meters to the one-line live header; network requires the metrics fixture below. |
| `symbols`             | `'emoji' \| 'ascii'`        | `'emoji'`                                    | Status markers; B&W always uses ASCII.                                                              |
| `includeSuiteTitles`  | `boolean`                   | `false`                                      | Include enclosing `test.describe` titles before the test title.                                     |
| `printFailureDetails` | `boolean`                   | `true`                                       | Print final unexpected failures with source locations and errors.                                   |
| `colors`              | `boolean`                   | Unset                                        | Compatibility option that forces ANSI on/off when `colorMode` is `'auto'`.                          |
| `printOutput`         | `boolean`                   | Unset                                        | Compatibility alias for `showLogs`.                                                                 |
| `outputFile`          | `string \| false`           | `'test-results/mixtape-reporter/issues.log'` | Failed/flaky diagnostics log, relative to the config directory. Use `false` to disable.             |

### Environment variables

| Variable                          | Values                    | Default    |
| --------------------------------- | ------------------------- | ---------- |
| `PLAYWRIGHT_MIXTAPE_COLOR_MODE`   | `auto`, `color`, `bw`     | `auto`     |
| `PLAYWRIGHT_MIXTAPE_THEME`        | `cassette`, `compact`     | `cassette` |
| `PLAYWRIGHT_MIXTAPE_ANIMATIONS`   | `true`, `false`, `1`, `0` | `true`     |
| `PLAYWRIGHT_MIXTAPE_INTERACTIVE`  | `true`, `false`, `1`, `0` | `true`     |
| `PLAYWRIGHT_MIXTAPE_SHOW_LOGS`    | `true`, `false`, `1`, `0` | `false`    |
| `PLAYWRIGHT_MIXTAPE_SHOW_METRICS` | `true`, `false`, `1`, `0` | `false`    |

Explicit options take precedence over their matching environment variables.
`showLogs` takes precedence over `printOutput`, which takes precedence over
`PLAYWRIGHT_MIXTAPE_SHOW_LOGS`. To control a setting through the environment,
leave its explicit option unset in the config. Empty boolean environment values
are treated as unset; invalid nonempty booleans and invalid theme/color-mode
values produce configuration errors.

These examples use POSIX shell syntax. In PowerShell, set the corresponding
`$env:VARIABLE` before running Playwright.

```sh
# Force ANSI colors and include test console logs.
PLAYWRIGHT_MIXTAPE_COLOR_MODE=color PLAYWRIGHT_MIXTAPE_SHOW_LOGS=true \
  npx playwright test --reporter=playwright-mixtape-reporter

# Plain B&W output, including plain forwarded test logs.
PLAYWRIGHT_MIXTAPE_COLOR_MODE=bw PLAYWRIGHT_MIXTAPE_SHOW_LOGS=true \
  npx playwright test --reporter=playwright-mixtape-reporter

# Original layout with animation disabled.
PLAYWRIGHT_MIXTAPE_THEME=compact PLAYWRIGHT_MIXTAPE_ANIMATIONS=false \
  npx playwright test --reporter=playwright-mixtape-reporter
```

### Automatic color and animation

In `colorMode: 'auto'`, a nonempty `NO_COLOR` or `FORCE_COLOR=0` disables ANSI.
Otherwise, nonempty `FORCE_COLOR` enables it, or an interactive stdout enables it
when `TERM` is not `dumb`. The legacy `colors` option overrides this detection.
`colorMode: 'color'` forces ANSI and `colorMode: 'bw'` disables ANSI regardless of
that legacy option or the standard color environment variables.

Animation requires all of these conditions:

- `animations` is enabled and the theme is `cassette`.
- ANSI color is enabled and stdout is an interactive TTY.
- `TERM` is not `dumb`.
- `CI` is unset, empty, `0`, or `false`.

Forcing color does not bypass the TTY, CI, or theme requirements. Other nonempty
`CI` values disable animation. Redirected output and B&W are always static.

## Appearance and alignment

The cassette theme uses a fixed ANSI 256-color palette:

| Role                                     | Color           |
| ---------------------------------------- | --------------- |
| Deck structure and skipped tests         | Lavender        |
| Running lanes                            | Teal            |
| Main text                                | Cream           |
| Passed tests                             | Green           |
| Live timing, attempts, and interruptions | Amber           |
| Completed-result durations               | Bright cyan     |
| Failed tests                             | Red             |
| Flaky tests                              | Yellow          |
| Secondary text and inactive lanes        | Muted blue-gray |

Colors communicate state and role. The two dot-matrix reels spin only while a
worker runs a test. The `compact` theme uses the original static heading and basic ANSI
status colors without a live deck. Completed result lines and outcome counters
use green for passed, yellow for flaky, and red for failed results in color mode.
Completed-result durations use contrasting bright cyan, including parentheses.
B&W mode retains its plain output.

Completed test entries have a fixed icon column followed by one separator space
and the description. Skipped tests use `⏩`, a default emoji-presentation marker,
to avoid variation-selector width differences. There is no extra dash
between the icon and the test identifier.
Continuation lines start under the description, including for skipped icons and
ASCII markers. The formatter measures display cells, preserving emoji,
combining characters, and wide characters while wrapping. Very long unbroken
strings are split to fit. Wrapping uses stdout's column count, falling back to
80 columns.

For plain output, set `colorMode: 'bw'`. This forces ASCII markers and removes
ANSI control sequences from forwarded test logs. `symbols: 'ascii'` alone changes
the markers while keeping the selected color behavior. Auto mode with color
disabled still uses the configured symbols.

## Live runner deck

The deck follows actual Playwright start/end events. Each cassette represents a
logical `parallelIndex` slot, without a displayed worker ID. When Playwright
restarts a worker process, its replacement reuses the same cassette position.
Configure concurrency through Playwright's `workers` setting or `--workers`;
the reporter adapts to 2, 3, 5, 6, 10, and larger worker counts.

```text
      TIME  CURRENT TEST                                             ATTEMPT
⟦⠴-⠇⟧ 00:09 API00153 - Verify that landing configuration is returned
⟦⠦-⠏⟧ 00:05 API00143 - Verify that fixture cleanup completes…          [2/2]
⟦○-○⟧ --:-- awaiting test
⟦○-○⟧ --:-- waiting for retry
```

The header describes concurrent test execution and elapsed runtime:

```text
6/6 RUN ██████ │ 00:52
```

`RUN` counts assigned Playwright test attempts, including test-scoped setup
and teardown. Each activity cell represents a worker in parallel-slot order. Completing an
attempt clears that worker's bar immediately. Each new attempt starts with an
empty 120 ms handoff frame, then smoothly fills through `▁▂▃▄▅▆▇` over 720 ms.
Back-to-back tests always start a fresh ramp instead of carrying a full bar from
the previous test. Idle workers and retry waiting stay empty (`·`). The activity
graphic illustrates test lifecycle events; it does not sample CPU usage. On
smaller terminals, slots are grouped using the highest level in each group and
header details shorten to fit on one line.

For example, two executing attempts in a six-worker run can look like this:

```text
2/6 RUN █▄···· │ 00:52
```

The first worker has reached full activity, the second is filling for a new
attempt, and the remaining four slots are inactive. A full bar means that a
test attempt is assigned; it is not a CPU-utilization measurement.

The two dot-matrix reels rotate while the test executes and stop for idle,
waiting, and completed attempts. Colors retain their fixed meaning. The compact
display omits worker ID, state, completed-attempt totals, and the graphic column
heading, leaving more room for the test title.

### Keyboard inspection

Keyboard controls are enabled by default when the live panel is visible and
stdin is an unclaimed TTY. A short help line appears below the frame:

```text
[p] hold display                  ↑↓ select · enter inspect · esc close
```

- `↑` / `↓`: select a parallel slot. Compact paging follows the selected slot.
- `Enter`: open or close its details, including the full title within the available
  space, source location, elapsed time, and retry number for second/later attempts.
- `Esc`: close details and clear selection.
- `P`: hold or resume periodic screen updates. Tests and completed-result output
  continue; this control never pauses test execution or replays tests.
- `Ctrl+C`: restores terminal input mode and follows Playwright's normal interruption flow.

Set `interactive: false` or `PLAYWRIGHT_MIXTAPE_INTERACTIVE=false` to disable
input handling. Controls are also disabled for redirected input or an input TTY
already in raw mode or with another input listener. The reporter restores input
mode and releases its listener at run end. CI, B&W, and static output stay unchanged.
The preview's playback button is represented by display hold in a real test run.

### System CPU and worker traffic

Enable resource measurements in the reporter configuration:

```ts
reporter: [['playwright-mixtape-reporter', { showMetrics: true }]],
```

CPU is sampled by the reporter directly. To include network traffic, use the
optional test fixture in specs, or as the base of your existing shared
fixtures. Keep existing `.extend()` definitions and assertions unchanged:

```ts
import { test, expect } from 'playwright-mixtape-reporter/metrics';

test('health check', async ({ request }) => {
  expect((await request.get('/health')).ok()).toBe(true);
});
```

For independently composed fixtures, use Playwright's `mergeTests`:

```ts
import { mergeTests } from '@playwright/test';
import { test as resources } from 'playwright-mixtape-reporter/metrics';
import { test as domain } from './domain-fixtures';

export const test = mergeTests(domain, resources);
```

```text
6/6 RUN ██████ │ CPU(SYS) ██▏··· 37% │ NET ▁▂▄▅▃▂▁· ↓0.67 ↑0.05 Mbit/s │ 00:18
```

- `CPU(SYS)` is total **system CPU utilization**, normalized across all logical
  CPU cores to **0–100%**. It includes test workers, browser processes, and other
  applications on the machine. The amber VU meter uses the same 0–100% scale,
  independent of the configured worker count. It is sampled using operating
  system CPU-time deltas and remains live between tests without a metrics fixture.
- `NET ↓` and `↑` sum received and sent HTTP byte deltas from **all
  instrumented test-worker processes** in one shared time window, including
  fixture traffic between tests and the final snapshots of replaced retry
  workers. Each byte delta is counted once; unchanged snapshots contribute zero.
  These rates include HTTP headers. Node HTTP/HTTPS socket counters cover Playwright API requests,
  including contexts created by your API clients. Browser traffic uses
  [Playwright request sizes](https://playwright.dev/docs/api/class-request#request-sizes)
  from completed requests in the built-in `context`/`page` fixtures. Completed
  browser downloads appear in the interval when they finish.
- Network values always use **decimal Mbit/s** (1 Mbit = 1,000,000 bits; 8 bits = 1 byte), with a
  shared unit and two decimals. The teal sparkline scrolls every 240 ms and
  shows recent combined upload/download rates on a fixed scale up to 8 Mbit/s
  (larger rates fill the graph; numeric values remain uncapped). Its shape
  changes with measured traffic; there is no decorative
  random motion or changing graph scale.
- These are application HTTP rates, not network-interface utilization. They
  exclude TLS/TCP framing, WebSocket payloads, native `fetch`/Undici traffic,
  subprocess traffic, and unfinished or failed browser downloads.
- Snapshots are collected about once per second; display values ease toward
  them on the existing 120 ms animation tick. Network rates use a 1-second
  rise and 2.4-second fall time constant; CPU uses 0.6/1.2 seconds. A burst
  followed by an empty sampling interval therefore settles gradually instead
  of flickering to zero. These are smoothed rates, not instantaneous values.
  The retained panel patches changed cells without repainting completed
  results. CPU continues to reflect the system even with no assigned tests;
  network follows worker byte activity and settles toward zero when traffic stops.
  `NET --` means an active worker has no metrics fixture or its snapshot is older
  than 2.5 seconds. CPU remains visible independently. `CPU(SYS) --` means that
  OS CPU counters are unavailable or a second sample is still pending.
- Worker count, the per-worker handoff animation, CPU, network, and elapsed
  time share one compact status line. Narrow terminals shorten graphs first,
  then resource labels or fields; worker activity and elapsed time take priority.
  Optional fields disappear as complete units instead of wrapping or clipping
  a numeric value. Meter graphs never add an extra row.

For additional browser contexts created manually, register each one:

```ts
test('multiple sessions', async ({ browser, mixtapeMetrics }) => {
  const context = await browser.newContext();
  mixtapeMetrics?.observeContext(context);
  try {
    const page = await context.newPage();
    // Use the page as usual.
  } finally {
    await context.close();
  }
});
```

Metrics collection runs only when the animated terminal panel and `showMetrics`
are enabled. The worker fixture otherwise does no sampling. Numeric snapshots use a
private temporary directory, separate from console output, traces and issue logs;
the reporter removes it on shutdown. URLs, headers and bodies are never stored.
No additional runtime dependency or privileged packet capture is required.

Import or merge the metrics fixture into your own test base. Keep custom
`context` overrides instrumented explicitly with
`mixtapeMetrics?.observeContext(context)` if they replace the metrics override.

| Display          | Meaning                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUN`            | Assigned test attempts divided by configured worker capacity.                                                                                             |
| Bars after `RUN` | A bar per worker; clear on completion, hold empty during handoff, then smoothly fill for the new attempt.                                                 |
| Header clock     | Wall-clock runtime since the run began.                                                                                                                   |
| Reel graphic     | Two reels separated by a single hyphen; rotation means execution.                                                                                         |
| `TIME`           | Elapsed time for the active attempt; inactive slots show `--:--`.                                                                                         |
| `CURRENT TEST`   | Executing test; inactive slots show `awaiting test` or `waiting for retry`. Long titles are shortened before the attempt column.                          |
| `ATTEMPT`        | Right-aligned retry number, such as `[2/3]` or `[3/3]`. First attempts and inactive slots are blank. The column stays available once a retry has started. |
| `DONE`           | Unique finalized test cases divided by selected cases. A failed attempt awaiting a retry does not advance completion.                                     |
| `RETRIES`        | Number of retry attempts that have started.                                                                                                               |

Running reels are teal, retry waiting is amber, and inactive reels are muted.
Completed entries keep their status colors in the result list. Attempts appear
at the right edge of each table column, including when titles contain wide
characters. Attempt labels appear only while a second or later attempt executes;
waiting for the first retry does not display an attempt label.

A skip emitted without a worker updates overall results without replacing an
active lane. Finished titles leave the live table as soon as their result is
listed, so each completed entry appears only in the result list. The worker bars measure execution state and time. Optional CPU and network
fields are sampled separately, as described above.

The live table uses one full-width row per worker, in parallel-slot order, even
on wide terminals. It keeps a single heading and the retry attempt at the far
right, giving test titles the available horizontal space. Narrow or short
terminals use miniature cassettes and page through them when needed. Current
titles may be shortened inside the deck; completed test entries retain the full
wrapped title.

### Smooth terminal updates

The live display updates automatically with `animations: true`; no extra option
is needed for incremental rendering.

- Completed attempts are inserted above the existing panel and remain in normal
  terminal scrollback. Printing a result does not clear and recreate the panel.
- Animation ticks patch changed cells, such as reels, activity bars, counts, and
  elapsed time. Unchanged test titles and completed result entries stay steady.
- A finished title leaves the live table when its result is printed. Idle slots
  show `awaiting test`; a failed attempt scheduled for retry shows `waiting for retry`.
- Supporting terminals present each update as one synchronized frame. Other
  terminals still receive the same cell updates and line insertions.
- Incomplete forwarded log lines pause animation until the line ends. Resize
  recovery and unusually oversized output can redraw the panel immediately,
  instead of clearing it and waiting for the next timer tick.
- The cursor is hidden while the panel is active and restored when it stops.
  Final cleanup removes the panel before the summary.

For static output, set `animations: false` or leave the explicit option unset
and set `PLAYWRIGHT_MIXTAPE_ANIMATIONS=false`. Static output retains result
colors according to `colorMode`. CI, redirected output, and B&W disable animation
automatically, as described in [automatic color and animation](#automatic-color-and-animation).

## Results and summary

The cassette theme finishes with a framed **FINAL MIX**: a colored run status,
semantic outcome totals, a green pass-rate bar, contrasting duration, and a
**DIAGNOSTICS** section. B&W uses an ASCII frame. The compact theme retains its
text summary and appends the diagnostics path. The run status appears once in
the frame; `Duration: 14m 49s` labels the total time. A timed-out run is labeled
`RUN TIMED OUT`.

Framed totals use fixed-width text badges such as `[PASS]` and `[FAIL]`, colored
by outcome. This avoids border shifts caused by terminals assigning different
cell widths to emoji. The `symbols` option still controls markers on completed
test lines and in the compact theme. Failure titles, source locations, and stack
lines wrap beneath their original indentation instead of continuing at the
terminal's left edge.

The diagnostics section labels the log **Failed and flaky tests** and shows
`Traces: N available` or `Traces: none recorded` on a separate line. It links both
`Open issues.log` and the displayed file path on color-capable interactive
terminals. Other terminals and redirected output show plain paths. Long paths
are shortened by removing leading directories, keeping `issues.log` intact on
one line. An unusually long custom filename is shortened in its middle. The
hyperlink still points to the complete absolute file path. Trace and attachment
paths in the log remain complete.

Each completed attempt gets a line, so an initial failure remains visible even
if a retry succeeds. Only second and later attempts include an `attempt N/M`
suffix; first-attempt results omit it. The final summary counts each selected Playwright test case
once, including each project/repeat instance:

- `passed`: expected outcomes, including tests marked `test.fail()` that fail as expected.
- `failed`: unexpected final outcomes, including unexpected passes and timeouts.
- `flaky`: cases that recover on retry, separate from passed.
- `skipped`: skipped cases.
- `interrupted`: cases whose last attempt was interrupted, shown when nonzero.
- `not run`: selected cases with no recorded results, shown when nonzero.

Pass rate is `passed / all selected test cases`, displayed to one decimal place.
Skipped, flaky, interrupted, and never-started cases remain in the denominator.
An empty selection shows `0/0 (0.0%)`. Runtime is Playwright's wall-clock duration,
not the sum of worker durations.

Global errors are counted separately and can fail a run with zero failed test
cases. The reporter preserves Playwright's run status and exit code, including
`failOnFlakyTests`; flaky cases can therefore accompany a failed run status.

## Logs and failure details

`showLogs: false` hides test stdout/stderr from this terminal reporter.
`showLogs: true` forwards those streams, including test console output. The
setting does not remove output captured by other reporters. Forwarded logs preserve
SGR colors only when reporter color is enabled. Terminal commands (including OSC
clipboard/hyperlink sequences, screen clearing, cursor movement, and control
strings) and bidirectional text controls are removed, even across chunks. Raw
terminal animations from tests are intentionally not supported.

During animation, complete stdout lines are inserted above the panel. Partial
lines pause animation so a later result cannot overwrite unfinished console
output. The next reporter result starts on a separate line when needed.

`printFailureDetails` independently controls the final unexpected-failure
section, including source locations and the last attempt's errors. Recovered
flaky attempts do not appear in that section. Global errors always appear;
setting `printFailureDetails: false` reduces them to their concise message.
Per-attempt status lines and the final summary remain visible with both options
disabled.

### Failed and flaky log

Each run writes a plain UTF-8 log to
`test-results/mixtape-reporter/issues.log`, relative to the directory containing
`playwright.config.*`. When no config file is available, including config-free
report merges, paths resolve from the current working directory.

```ts
reporter: [
  [
    'playwright-mixtape-reporter',
    {
      outputFile: 'test-results/mixtape-reporter/issues.log',
      showLogs: false,
      printFailureDetails: false,
    },
  ],
];
```

The log includes:

- Failed and flaky test titles, project/suite names, source locations, and expected status.
- Every attempt, including the original error before a successful retry, with status and duration.
- Errors and captured stdout/stderr for those attempts, even when `showLogs` hides console output.
- Trace and other attachment paths, file URLs, and commands to open available traces.
- Run status, duration, and any global errors.

Ordinary passes, expected failures, and skipped tests are excluded from the
detailed log. A clean run replaces the file with a current-run header and
`No failed or flaky tests.`; it does not leave a stale failure log behind.
`showLogs` and `printFailureDetails` affect terminal output independently of this
file. Set `outputFile: false` to disable file generation and its summary link.

Logs can contain credentials, personal data, and internal paths printed by your
tests. The reporter does not redact secrets automatically. Review logs and traces
before uploading them. New issue logs and extracted in-memory traces use owner-only
permissions on POSIX; existing Playwright artifacts retain their own permissions.
Windows access is governed by the output directory's ACL. Trace-opening commands
use POSIX shell quoting on Unix and PowerShell quoting on Windows.

The log is generated after execution and replaced atomically. Captured output is
written incrementally, avoiding a second full in-memory copy. Separate concurrent
runs should use distinct `outputFile` paths; otherwise the last completed run wins. Shards append
`-shard-N-of-M` before the extension, for example
`issues-shard-2-of-3.log`, including for custom filenames. A report merge writes
a consolidated log. A write error is shown as `Issue log unavailable` without
changing Playwright's test status or exit code.

Trace collection follows Playwright's configuration; the reporter does not
enable it. A typical configuration to retain failing attempts is:

```ts
use: {
    trace: 'retain-on-failure',
}
```

Open a retained trace with
`npx playwright show-trace path/to/trace.zip`. See the
[Playwright Trace Viewer guide](https://playwright.dev/docs/trace-viewer) for
capture modes and viewing options. Missing traces are labeled `not recorded`
or `file unavailable`; they are excluded from the available-trace count.
Trace attachments supplied as buffers are saved beside the log in
`<log-name>-traces/` so they can be opened too. Existing file attachments are
referenced in place.

For CI, retain the log together with the trace/attachment files. After download,
preserve their relative directory layout and use the `From log directory`
commands in the log; absolute links refer to the machine that produced it.
The default log sits inside `test-results/` so it is included when that directory
is uploaded as an artifact.

## CI and sharded runs

Use the normal config-based test command to keep the reporter array, including
HTML/JSON artifacts. CI automatically disables animation; ANSI colors can still
be requested with `PLAYWRIGHT_MIXTAPE_COLOR_MODE=color`.

For sharded runs, include the built-in blob reporter:

```sh
npx playwright test --shard=1/3 --reporter=playwright-mixtape-reporter,blob
npx playwright test --shard=2/3 --reporter=playwright-mixtape-reporter,blob
npx playwright test --shard=3/3 --reporter=playwright-mixtape-reporter,blob
```

Run each shard in its own job and collect its blob ZIP into a shared merge
input directory. For example, save this as `playwright.merge.config.ts` in the
consuming project:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['playwright-mixtape-reporter'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'results/merged.json' }],
  ],
});
```

```sh
npx playwright merge-reports --config=playwright.merge.config.ts all-blob-reports
```

The merge replays recorded reporter events to produce consolidated terminal
results. It does not execute tests. `--reporter` overrides apply to merge commands
too, so use a merge config to retain artifact reporters.

## Troubleshooting

| Symptom                                        | Check                                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No animation                                   | Use an interactive terminal, cassette theme, and enabled ANSI color. Check `CI`, `TERM`, and the animation option/environment variable.                 |
| No ANSI colors                                 | Check `colorMode`, `NO_COLOR`, `FORCE_COLOR`, the legacy `colors` option, and stdout TTY detection.                                                     |
| Emoji alignment differs in the terminal font   | Use `symbols: 'ascii'`, or `colorMode: 'bw'` for plain ASCII output.                                                                                    |
| Titles wrap at 80 columns                      | The output stream does not expose a width, so the formatter uses its fallback.                                                                          |
| Some runners stay idle                         | The deck reports observed execution; the selected tests, scheduling, or suite dependencies may use fewer slots than configured.                         |
| All activity bars are full                     | Every slot has an assigned attempt past its initial ramp. Bars reset at each completion and new attempt; the chart does not measure CPU use.            |
| Finished titles remain in the live table       | Rebuild the package, or rebuild and reinstall the tarball in the consuming project. The current renderer replaces finished titles with a waiting label. |
| A static report is preferred                   | Set `animations: false`, or leave that option unset and use `PLAYWRIGHT_MIXTAPE_ANIMATIONS=false`. Color and test-log settings remain independent.      |
| An environment setting has no effect           | Remove the corresponding explicit option; for logs, also check the legacy `printOutput` option.                                                         |
| Console output is hidden but errors remain     | `printFailureDetails` controls diagnostics separately from `showLogs`.                                                                                  |
| Run failed with `failed: 0`                    | Check the printed run status, flaky cases, global errors, and interrupted cases.                                                                        |
| HTML or JSON report disappeared                | Remove the CLI `--reporter` override or include the artifact reporter in the chosen reporter array.                                                     |
| Module cannot be resolved in a source checkout | Run `npm run security` and `npm ci --ignore-scripts` at the repository root, then rebuild after source edits. See the development guide.                |
