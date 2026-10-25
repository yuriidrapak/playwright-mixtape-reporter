# Changelog

## 1.0.0 — 2026-10-25

- Initial standalone release as `playwright-mixtape-reporter`, under MIT.
- Cassette and compact terminal themes, live parallel workers, keyboard
  inspection, ASCII mode, configurable logs, and CI-friendly static output.
- Correct retry, flaky, expected-failure, interruption, and shard-merge summaries.
- Atomic failed/flaky diagnostic logs with retained trace references.
- Optional system CPU and worker HTTP metrics, without runtime dependencies.
- Streamed terminal-output filtering, private diagnostic files, bounded metrics
  reads, and idempotent listener cleanup.
- Clean ESM build, TypeScript declarations, package-consumer checks, cross-platform
  CI, and an npm trusted-publishing workflow.
- Explicit build/pack commands without lifecycle hooks, strict archive inspection,
  dependency integrity policy, seven-day release-age filtering, and regression tests.
- Separate build and OIDC publish jobs with digest verification of the tested tarball.
- Contributor/agent guidance, incident analysis, and performance measurement docs.

Requires patched Node 22.23.4+, 24.22.1+, or 26.12.1+ on those release lines,
and Playwright Test 1.64.1–1.x. The earlier unpublished
workspace prototype used a different name. Configuration now uses
`playwright-mixtape-reporter`, `MixtapeReporterOptions`, `PLAYWRIGHT_MIXTAPE_*`,
`mixtapeMetrics`, and `test-results/mixtape-reporter/issues.log`.
