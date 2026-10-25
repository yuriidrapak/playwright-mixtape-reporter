# Security policy

Security fixes target the latest released 1.x version. Use a maintained Node.js
release and keep Playwright updated. Current patch floors are Node 22.23.4,
24.22.1, and 26.12.1 on those release lines, following the
[October 21, 2026 Node security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).
Review later advisories; these floors are not a permanent safety guarantee.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/yuriidrapak/playwright-mixtape-reporter/security/advisories/new)
when enabled. If the private form is unavailable, open an issue requesting a
private reporting channel **without exploit details or sensitive data**. Do not
attach credentials, customer data, or private test artifacts to public issues.
Maintainers must enable private vulnerability reporting before the public launch.

Include affected versions, reproduction steps, impact, and a proposed fix if
available. Response times are best effort; this project has no security SLA.

## Data handling

- No telemetry or outbound requests originate from the reporter. Metrics observe
  local byte counters and completed browser request sizes without storing URLs,
  headers, bodies, or credentials.
- Failure/flaky logs include test errors, captured stdout/stderr, local paths,
  and trace locations. These may contain secrets. No automatic redaction is
  promised. `showLogs: false` hides terminal logs; `outputFile: false` disables
  the reporter's diagnostic file.
- `includeOutputInDiagnostics: false` omits captured stdout/stderr from the file.
  `redactDiagnosticText` transforms complete sanitized log lines, including errors
  and paths. Callback failures and lines over its 64 KiB buffer are omitted.
  It does not redact terminal output, other reporters, or traces. The default
  `maxDiagnosticBytes` cap is 10 MiB, with visible truncation; trace files are
  outside this cap. These controls do not guarantee that artifacts are safe to share.
- Generated issue logs and extracted traces use mode `0600` on POSIX. Metrics
  use a private temporary directory. Windows relies on directory ACLs. Existing
  attachments are referenced without changing their permissions.
- Test output is filtered before forwarding: terminal commands and bidi controls
  are removed; only allowlisted SGR colors/basic styles remain, with resets between
  forwarded writes. Concealment and blinking are rejected. This is display hardening, not a
  sandbox for untrusted tests. Playwright tests already execute as your OS user.
- Output destinations are trusted configuration. Use separate locations for
  concurrent runs. Logs are replaced atomically; artifacts referenced from
  earlier runs are not automatically deleted. Apply your own retention policy.
- Package contents are allowlisted. Runtime dependencies are limited to Node
  built-ins and the consuming project's Playwright peer. Consumers have no
  package install scripts.

Review logs and traces before sharing or uploading CI artifacts. Protect release
access with account 2FA, reviewed changes, and npm trusted publishing.

## Dependency and publication controls

Development requires npm 11.19+. Repository `.npmrc` disables install scripts,
pins the registry, saves exact versions and filters releases younger than seven
days. The lockfile policy checks dependency identities, SHA-512 integrity and
absence of install hooks. Verified urgent security updates may need a documented,
narrow age exception; do not postpone a critical fix for a cooldown.
The policy also queries only npm's four non-secret effective settings, rejecting
unsafe inherited environment settings and duplicate-key overrides. It never dumps
the full npm configuration or includes rejected values in errors.
CI also passes the seven-day minimum directly to installation commands, because
npm does not export release-age CLI flags to lifecycle scripts.

`npm run pack` builds explicitly and inspects actual archive bytes against a
reviewed file inventory. It rejects extra files, links, debug source material and
common credential patterns. No source maps or agent files are shipped. Source
maps are not intrinsically unsafe in open source; this is an artifact-minimization
policy. `npm run test:package -- <tarball>` checks the exact artifact consumers get.

Publication requires a manual Actions request for a version already committed
on `main`. The request verifies or creates an immutable tag and dispatches the
tag run. Its optional maintainer GitHub token is limited to tag creation in a job
without dependency installation; it is not passed to tests, builds or npm. The
workflow does not publish on PR merges or GitHub Release events.

The release workflow separates dependency execution from the job with OIDC
publishing rights. The final job verifies the tested tarball's digest and publishes
with lifecycle scripts disabled. Configure the protected environment, branch
rules, account 2FA and npm publishing restrictions described in the
[release guide](https://github.com/yuriidrapak/playwright-mixtape-reporter/blob/main/docs/releasing.md).
CODEOWNERS alone does not enforce review.

Install-script blocking cannot stop malicious code executed by an import, build,
test, or linter. Provenance identifies the build origin, not code safety. An audit
only covers known registry advisories; the credential scan is deliberately
limited. Run untrusted code without access to publishing or personal credentials.
See the dated [incident analysis and response guide](https://github.com/yuriidrapak/playwright-mixtape-reporter/blob/main/docs/supply-chain-security.md).
