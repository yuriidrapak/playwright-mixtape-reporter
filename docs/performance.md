# Performance and operational budgets

Runtime behavior and measured rendering cost are separate: a synthetic benchmark
cannot establish the overhead of terminals, filesystem I/O, metrics or a user's
test suite.

## Runtime constraints

- One unreferenced 120 ms animation timer. Patch changed cells, skip periodic
  frames under stdout backpressure, and avoid synchronous filesystem work during
  animation. Static/CI output does not run an animated dashboard.
- Preserve completed output in scrollback and fit the retained panel to terminal
  height. Unicode/grapheme width handling must survive optimizations.
- Optional metrics poll about once per second, with at most 16 concurrent reads
  and 4 KiB per snapshot. Observe byte counts without retaining request bodies or
  histories. Remove timers and request/socket/context listeners idempotently.
- Write diagnostics incrementally at completion through a private temporary file,
  then atomically replace it. Avoid duplicating all stdout/stderr in
  `Buffer.concat` or one large report string.
- The reporter still references Playwright's test results. Incremental writing
  avoids extra copies; it does not bound Playwright's memory for large suites or
  unlimited output. Keep noisy output under control at its source.
- Restore cursor, input listeners and raw mode on normal teardown. Forced process
  termination can prevent cleanup. Use distinct log paths for concurrent runs.

## Measure a change

```sh
npm run bench
npm run check
npm run test:browser # for browser/metrics lifecycle changes
```

`scripts/benchmark.mjs` warms the renderer and reports ten-worker render/diff
median, p95, changed text bytes per frame and the frame interval. It excludes
terminal writes, metrics polling, Playwright execution and diagnostics I/O.
Compare before/after on the same machine, runtime, workload and terminal settings.
Avoid brittle millisecond CI thresholds across shared runners.

The dated [release review](release-readiness.md#validation) records observations,
not a service-level promise. For an end-to-end improvement claim, also compare
representative API/browser suites with the reporter disabled, static, animated,
and with metrics enabled. Record elapsed time, peak RSS, output volume, retries
and workload; repeat enough times to distinguish a change from normal variation.

Preview six and ten workers, resize the terminal, and check retained scrollback,
long Unicode titles, retries and cursor restoration. Keep changes subject to
[AGENTS.md](../AGENTS.md): filtering output and protecting logs must not be traded
away for a faster benchmark.
