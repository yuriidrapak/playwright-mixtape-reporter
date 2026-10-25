# Changelog

## Unreleased

- Validate effective npm policy settings, rejecting unsafe overrides without
  exposing configuration values.
- Add diagnostic output omission, per-line redaction with bounded buffering and
  fail-closed callback handling, and a configurable 10 MiB issue-log limit.
- Restrict forwarded SGR to supported colors/basic styles and isolate styles
  across output writes while retaining each stream's chunked color state.
- Document separate release-tag creation restrictions and immutable-tag rules.

## 1.0.1 — 2026-10-25

- Correct the release workflow's local tarball path to `./release/<filename>`.
  npm interpreted the earlier path as GitHub shorthand, so `1.0.0` passed all
  validation and artifact checks but was not published to npm. The existing
  GitHub tag is preserved; this patch is the first npm publication candidate.

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
