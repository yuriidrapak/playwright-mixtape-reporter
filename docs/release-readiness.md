# Release readiness review

Reviewed on 2026-10-25 for the initial `playwright-mixtape-reporter@1.0.0` release.
Scope: all reporter source modules, existing tests, npm packaging, documentation,
dependency advisories, terminal safety, metrics lifecycle, and release automation.

## Findings and changes

| Area                    | Finding                                                                                               | Resolution                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package identity        | Metadata, imports, options, environment variables, and docs used the unpublished prototype name.      | Standardized on Mixtape throughout; public migration names are listed in the changelog.                                                                 |
| License                 | `package.json` said `UNLICENSED` despite an MIT license file.                                         | Declared MIT and included the license in the verified tarball.                                                                                          |
| Reproducibility         | No lockfile; the compiler used an unnecessary package alias; the build could retain stale files.      | Pinned current development tools, a lockfile, direct TypeScript dependency, clean build.                                                                |
| Compatibility           | Node 20 was declared despite its EOL; the Playwright range extended far below the tested version.     | Patched Node 22.23.4+, 24.22.1+, or 26.12.1+ on those lines and Playwright 1.64.1–1.x; exact Node 22 minimum tested.                                    |
| Terminal output         | Forwarded logs could execute terminal controls; chunk boundaries defeated simple per-chunk stripping. | Incremental UTF-8/control-sequence filtering, bounded parser state, optional SGR colors, sanitized titles and path labels.                              |
| File privacy            | Issue logs and extracted in-memory traces used default filesystem permissions.                        | Owner-only new files on POSIX, exclusive temporary creation and atomic replacement, symlink regression coverage.                                        |
| Diagnostics memory      | Captured output was concatenated into duplicate buffers and an entire log string.                     | Write output chunks incrementally to the temporary log, preserving atomic publication.                                                                  |
| Metrics cleanup         | Repeated startup and stopped observers could retain timers/listeners.                                 | Idempotent lifecycle and explicit request, socket, and context listener removal.                                                                        |
| Metrics resource bounds | Polling opened every snapshot concurrently and read unbounded files.                                  | At most 16 concurrent reads and 4 KiB per snapshot.                                                                                                     |
| Test portability        | Integration setup depended on the former parent workspace.                                            | Standalone source integration plus a real tarball installed outside the checkout.                                                                       |
| Code quality            | No runnable standalone lint/format checks.                                                            | Oxlint, Prettier, EditorConfig, strict TypeScript, and erasable syntax validation.                                                                      |
| Open source docs        | Setup commands and private-project references did not apply here.                                     | Standalone installation/development docs, contributing guide, security policy, changelog, issue and PR templates.                                       |
| Release supply chain    | No CI or publishing workflow.                                                                         | Script blocking, release-age filtering, strict dependency/artifact policies, pinned actions, separated build/OIDC publish jobs and digest verification. |

## Validation

- Node 24.22.1 and Node 22.23.4 on macOS arm64, with npm 11.19.1: policy, lint,
  formatting, types, all **61 tests**, and external-consumer tarball checks passed.
  Both temporary Node archives were checked against official SHA-256 checksums.
  Earlier validation on 24.21.0/22.18.0 was superseded after checking the October
  security advisory; those old versions are no longer supported baselines.
- Real Chromium smoke: local API and browser tests, a recovered retry, retained
  trace ZIP, and worker byte snapshots.
- npm audit: zero known vulnerabilities in the locked dependency graph at review
  time. There are no declared production dependencies; Playwright is a peer.
- Shipped archive: no common credential-pattern matches. Regression tests use
  synthetic credential fixtures. This limited scan does not prove absence of
  sensitive data or audit the maintainer's machine.
- Fresh consumer: public ESM import, Node `require()` interoperability, TypeScript
  declarations, metrics fixture, and Playwright execution with ESM and CommonJS
  config files. The actual archive is parsed against an exact 39-file inventory, compared to
  the build, checked for debug material/common credentials, and size-limited.
- Final tested tarball: **44,294 bytes**, **39 files**; SHA-256
  `9551aca6d437bfaaebc35f292bccde1d7187ae0eb793ab2ca0d35d124cb2283c`.
- Synthetic ten-worker render/diff benchmark on Node 24.22.1/macOS: median
  **0.684 ms**, p95 **0.902 ms**, approximately **150 changed text bytes/frame**,
  against a 120 ms frame interval. This excludes terminal I/O, metrics polling,
  and test execution; it is not an end-to-end overhead claim.

The supply-chain follow-up reviewed the OpenAI/Axios incident, Anthropic packaging
exposure, and malicious unofficial AI-named packages. No listed incident package
was found in the 47-entry dependency lock graph. Four new regression tests cover
archive boundaries, debug/credential leakage, dependency policy and runtime floors.
See [incident evidence and control limits](supply-chain-security.md),
[performance budgets](performance.md), and [agent instructions](../AGENTS.md).

The retained renderer already skips periodic frames under stdout backpressure,
patches only changed cells, and uses one unreferenced timer. Diagnostics are
generated at run completion. No runtime dependency was added.

## Remote validation

Pre-publication GitHub CI passed all six Node/platform jobs and the Chromium
smoke test. The public release workflow repeats these checks on the exact release
commit; see [GitHub Actions](https://github.com/yuriidrapak/playwright-mixtape-reporter/actions).
Linux covers the
exact Node 22 minimum and latest patched 22/24/26 lines; macOS and Windows cover
Node 24. Windows passes 60 tests and intentionally skips the POSIX-only PTY test.
All other platform test jobs pass 61 tests, including external package consumers.

The first remote runs exposed and resolved three validation issues: generating
self-reference declarations before type checking, selecting patched runtimes
instead of stale runner caches, and fetching peer metadata while enforcing the
reviewed consumer dependency graph. Windows assertions now use native paths.

## Remaining release gates

1. Publish the reviewed source with one initial commit using GitHub's no-reply
   email. Earlier private history and pull requests are excluded from the public
   repository. Enable private vulnerability reporting and require all seven
   GitHub CI checks on `main`.
2. Complete npm's authentication approval for the trusted publisher. The npm
   owner is authenticated and account 2FA is enabled. Configure the `npm` GitHub
   environment to restrict deployment to `v*` tags.
3. Publish the `v1.0.0` GitHub release after the source/identity settings are ready;
   the workflow reruns the full validation for that exact commit before publishing.
4. Verify the resulting npm version, digest and provenance; reject the temporary
   unpublished bootstrap stage. See [releasing](releasing.md).

The npm name has been reserved through staging. The temporary stage is not a
production release and must never be approved. Until the publication workflow
succeeds, `1.0.0` is not published.

## Operational limits

Logs and traces may contain secrets from tests; automatic redaction is not
provided. Windows file privacy depends on directory ACLs. Concurrent runs need
different log paths. A forced process termination can prevent terminal/temp-file
cleanup. Native fetch/Undici and WebSocket payloads are outside the optional
network metric's scope. Large Playwright reports still retain Playwright's own
test results in memory; incremental log writing only avoids extra reporter copies.

The review supports a tested release candidate, not a guarantee of absence of
bugs or vulnerabilities. Re-run the release gates for each published version.

## Guidance checked

- [Node release support](https://nodejs.org/en/about/previous-releases): use a
  maintained release line; Node 20 is EOL.
- [Native TypeScript execution](https://nodejs.org/learn/typescript/run-natively):
  the development test runner uses erasable syntax on supported patched runtimes.
- [October 2026 Node security fixes](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases):
  supersedes the original runtime minimum with patched versions.
- [Playwright reporters](https://playwright.dev/docs/test-reporters): reporter
  configuration, multiple reporters, and custom reporter behavior.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
  [provenance](https://docs.npmjs.com/generating-provenance-statements/): OIDC,
  compatible tooling, public source requirements, and first-release setup.
