# playwright-mixtape-reporter

A compact terminal reporter for Playwright API and browser tests, with a retro
cassette theme and a live view of parallel workers. Written in TypeScript,
compiled to native ESM, with zero runtime dependencies.

- Fixed phosphor colors communicate test states; dot-matrix reels and a one-line activity graph show each test handoff.
- The live panel updates changed cells in place, keeping unchanged titles steady.
- Completed attempts print once above the panel and stay in scrollback, with icons, aligned wrapped titles, contrasting durations, and retry numbers from the second attempt.
- Color, B&W, test console logs, and animation are configurable.
- The final mix frames the run status, colored totals, pass rate, duration, and a linked log for failed and flaky tests with errors, captured output, and available traces.
- A one-line status bar combines worker activity, system CPU, network, and elapsed time; arrow keys and Enter inspect workers, and P holds display updates while tests continue.
- Optional total system CPU VU meters and combined worker network history show smoothed CPU percentages and traffic in Mbit/s. Network uses the [metrics fixture](docs/usage.md#system-cpu-and-worker-traffic), with no extra runtime dependencies.
- CI and redirected output use a static report. HTML, JSON, and blob reporters can run alongside it.

[Configuration and usage](docs/usage.md) · [Development and packaging](https://github.com/yuriidrapak/playwright-mixtape-reporter/blob/main/docs/development.md)

## Requirements

Patched Node.js **22.23.4+, 24.22.1+, or 26.12.1+** on those release lines,
and **Playwright Test 1.64.1 or newer in the 1.x series**.
The package is native ESM; Playwright can load it from both ESM and CommonJS
config files. API tests need no browser installation.

## Install

```sh
npm install --save-dev playwright-mixtape-reporter @playwright/test
```

To build and install a local tarball from source:

```sh
# In this repository (use .nvmrc and npm 11.19+):
nvm install
nvm use
npm run security
npm ci --ignore-scripts
npm run check
npm run pack
npm run test:package -- ./playwright-mixtape-reporter-1.0.3.tgz

# In your Playwright project, use the tarball's actual path:
npm install --save-dev /path/to/playwright-mixtape-reporter-1.0.3.tgz
```

No build or install hooks run when consumers install the published package.
The tarball contains compiled JavaScript, TypeScript declarations, MIT license,
usage documentation, and the demo.

## Configure Playwright

Add the reporter to `playwright.config.ts`. The same configuration works for API
and E2E tests; no test or fixture changes are needed.

```ts
import { defineConfig } from '@playwright/test';
import type { MixtapeReporterOptions } from 'playwright-mixtape-reporter';

export default defineConfig({
  reporter: [
    [
      'playwright-mixtape-reporter',
      {
        theme: 'cassette',
        colorMode: 'auto',
        animations: true,
        showLogs: false,
      } satisfies MixtapeReporterOptions,
    ],
  ],
});
```

Preserve any existing HTML, JSON, or other reporters in the array. Then run your
usual test command:

```sh
npx playwright test
npx playwright test --workers=10
```

For a one-off terminal-only run:

```sh
npx playwright test --reporter=playwright-mixtape-reporter
```

The CLI `--reporter` flag replaces the configured reporter array. Use the config
when you also want the project's artifact reporters.

## Output

Illustrative completed-attempt output at a narrow terminal width:

```text
  ✅ [Chrome] › TC0101 - Verify that the booking keeps its selected
     extras when the guest changes the rental duration (17s)
  ❌ [API] › API00001 - Verify that a quote is returned when available
     (1s)
  🟡 [API] › API00001 - Verify that a quote is returned when available
     (900ms) · attempt 2/2
  ⏩ [Chrome] › TC0102 - Verify that export is available when enabled
     (0ms)
```

Each test's final outcome counts once. A recovered retry is flaky, and an
expected failure is passed. [Summary semantics](docs/usage.md#results-and-summary)
explain the pass-rate denominator and run status.

The cassette summary ends with a diagnostics section and an `Open issues.log`
link. Its fixed-width text badges keep borders aligned across terminal emoji
width settings; completed test lines retain the configured icons. Long failure
titles and stack traces use hanging indentation. By default, each run writes `test-results/mixtape-reporter/issues.log`
relative to the Playwright config directory. It includes every attempt for failed
and flaky tests, including failures that recovered, with trace paths and commands
to open recorded traces. [Failed and flaky log](docs/usage.md#failed-and-flaky-log)
explains path overrides, sharding, trace capture, and `outputFile: false`.

In an interactive terminal, results are inserted above the existing live panel.
Finishing a test clears its live title and activity bar; the slot shows
`awaiting test` or `waiting for retry` until the next attempt starts. The panel
is retained when results are printed, and animation ticks update only changed
cells. See [smooth terminal updates](docs/usage.md#smooth-terminal-updates).

## Preview parallel runners

From this repository's root, after `npm run build`:

```sh
npm run demo -- --workers=6
npm run demo -- --workers=10
```

From a project with the tarball installed:

```sh
node node_modules/playwright-mixtape-reporter/demo.mjs --workers=10
```

The demo labels its simulated events and needs no browsers, credentials, or
network calls. It accepts 1–64 workers, defaults to 6, and includes a retry and a
skip. The actual reporter uses Playwright's configured worker count.

See the [live runner guide](docs/usage.md#live-runner-deck) for lane states,
progress, and the terminal conditions required for animation.

## Documentation

- [Options and environment variables](docs/usage.md#configuration-reference)
- [Retro styling, B&W, and alignment](docs/usage.md#appearance-and-alignment)
- [Console logs and failure details](docs/usage.md#logs-and-failure-details)
- [Failed/flaky log and trace links](docs/usage.md#failed-and-flaky-log)
- [Live workers and smooth terminal updates](docs/usage.md#live-runner-deck)
- [CI and merged shard reports](docs/usage.md#ci-and-sharded-runs)
- [Troubleshooting](docs/usage.md#troubleshooting)
- [Build, tests, and packaging](https://github.com/yuriidrapak/playwright-mixtape-reporter/blob/main/docs/development.md)
- [Supply-chain incident analysis and safeguards](https://github.com/yuriidrapak/playwright-mixtape-reporter/blob/main/docs/supply-chain-security.md)
- [Performance budgets and measurement](https://github.com/yuriidrapak/playwright-mixtape-reporter/blob/main/docs/performance.md)

## Security and privacy

The reporter makes no outbound network requests. Optional metrics record numeric
byte counters; they do not capture request URLs, headers, or bodies. Diagnostic
logs include failure messages, captured test output, source paths, and trace
locations, which can contain secrets or personal data. Review artifacts before
sharing; `showLogs: false` does **not** disable the file log. Set `outputFile: false`
to disable it. `includeOutputInDiagnostics: false` omits captured output from the
file; `redactDiagnosticText` optionally transforms its lines. Issue logs default
to a configurable 10 MiB cap. These controls do not redact terminal output or
trace contents. See [diagnostic controls](docs/usage.md#failed-and-flaky-log) and
the [security policy](SECURITY.md).

Release checks inspect the compressed tarball against an exact file inventory,
reject debug sources and common credential patterns, and test its public exports
in a fresh consumer. Build/test and OIDC publishing run in separate jobs. These
checks reduce specific risks; they do not prove arbitrary dependency code safe.

## Contributing and releases

Contributions are welcome under the [MIT license](LICENSE). Start with
[CONTRIBUTING.md](https://github.com/yuriidrapak/playwright-mixtape-reporter/blob/main/CONTRIBUTING.md)
and the [development guide](https://github.com/yuriidrapak/playwright-mixtape-reporter/blob/main/docs/development.md).
Maintainers can follow the [npm release guide](https://github.com/yuriidrapak/playwright-mixtape-reporter/blob/main/docs/releasing.md).
Publication starts manually from **Actions → Publish npm package → Run workflow**
with the version already committed on `main`.
The initial release is tracked in [CHANGELOG.md](CHANGELOG.md).
