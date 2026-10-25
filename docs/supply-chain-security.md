# npm supply-chain review

Reviewed on **2026-10-25**. Scope: this package, locked development dependencies,
build/release automation, and the published artifact. This is not an audit of the
maintainer's computer, unrelated global packages, or every historical attack.
None of the incident packages below was present in the reviewed lockfile.

## Incident evidence and relevance

Dates distinguish incidents from later disclosure. These events do not all mean
an official AI product or npm itself was compromised.

| Evidence                                                                                                                                                                          | What happened                                                                                                                                                                                                                                                                                    | Application here                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OpenAI disclosure, April 10, 2026](https://openai.com/index/axios-developer-tool-compromise/)                                                                                    | A March 31 macOS signing workflow executed malicious Axios 1.14.1. OpenAI reported no evidence of compromised user data, products or intellectual property and rotated signing material. It identified a floating action tag and absent minimum release age as contributing workflow weaknesses. | Pin action commits, delay routine new dependency releases, and separate dependency execution from release credentials.                                    |
| [Axios maintainer postmortem, issue opened April 2, 2026](https://github.com/axios/axios/issues/10636)                                                                            | A compromised maintainer account published Axios 1.14.1 and 0.30.4 with malicious `plain-crypto-js`. Discussion clarifies that legitimate v1 releases already used OIDC; an alternate account publishing route bypassed CI.                                                                      | Review transitive dependencies and restrict alternate publishing paths. OIDC alone does not prevent account publication through another authorized route. |
| [Anthropic statement reported by Axios, March 31, 2026](https://www.axios.com/2026/03/31/anthropic-leaked-source-code-ai)                                                         | Anthropic attributed exposed internal code to a packaging error, reporting no customer-data or credential exposure.                                                                                                                                                                              | Inspect the actual archive and embedded debug material. Open-source publication still must exclude credentials and unrelated files.                       |
| [Aikido investigation, May 27, updated September 24, 2026](https://www.aikido.dev/blog/codex-remote-ui-steals-ai-tokens)                                                          | The third-party `codexui-android` npm package concealed credential theft in a compiled chunk executed on import; its public GitHub source appeared clean. This was not an official OpenAI package.                                                                                               | Install-script blocking is insufficient. Inspect shipped bytes, test outside the repository, and keep build tools away from credentials.                  |
| GitHub malware advisories, October 19, 2026: [codex-setup](https://github.com/advisories/GHSA-h8cg-xwfv-9x77), [api-anthropic](https://github.com/advisories/GHSA-cj9w-7h22-q93g) | Both packages are classified as malware, with all versions affected and no patched version. A product-like name does not establish a publisher's identity.                                                                                                                                       | Reject these known indicators and verify identities before installation. This small denylist is a regression guard, not a malware database.               |

An older precedent is [GitHub's September 2025 Shai-Hulud report](https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/):
install-time malware stole credentials and spread through maintainer accounts.
Credential isolation and script restrictions remain relevant.

We did not download leaked proprietary code or execute malicious packages. The
controls below are our engineering conclusions from the cited mechanisms; they
do not establish that this project was previously compromised.

## Implemented boundaries

| Boundary             | Enforced control                                                                                                                                                                                                                                                                    | Limit                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Runtime              | Zero declared runtime dependencies; Node built-ins and the consuming project's Playwright peer. No reporter telemetry, outbound requests, or credential discovery.                                                                                                                  | Tests and development tools execute with the user's privileges.                                                                   |
| Dependency selection | Exact direct versions, committed lockfile, public registry, seven-day `min-release-age`, weekly Dependabot with seven-day routine-update cooldown.                                                                                                                                  | Age is not trust; locked versions still need review. Urgent fixes must not be delayed unnecessarily.                              |
| Before installation  | `npm run security` checks runtime/npm versions, metadata consistency, canonical tarball identities, SHA-512 integrity, known incident packages, and absence of linked/bundled/install-script dependencies.                                                                          | Lockfile declarations can be malicious or inaccurate. Policy checks are not a code audit.                                         |
| Installation         | Repository `ignore-scripts=true`; CI explicitly passes `--ignore-scripts`. Builds are explicit commands.                                                                                                                                                                            | Imports and explicitly invoked tools can execute arbitrary code. npm configuration is not an OS sandbox.                          |
| Artifact             | Clean build, explicit map settings, narrow package globs, exact inventory in `scripts/artifact-policy.mjs`. Parse compressed bytes without extraction; reject links, duplicates, unexpected paths, executable modes, excess sizes, debug references and common credential patterns. | Pattern detection is incomplete. A malicious compiler could modify an allowed file without triggering patterns.                   |
| Consumer             | Compare every archive entry to the workspace build, then install the same file into an external consumer and test imports, declarations, both config formats and Playwright execution.                                                                                              | Confirms tested behavior, not absence of malicious code.                                                                          |
| Credentials          | Build/test has no npm environment or OIDC rights. A separate job receives only the tested tarball, verifies SHA-256/name, then publishes with scripts disabled. Actions use commit SHAs; release jobs have no shared dependency cache.                                              | Digest verification proves transfer integrity, not a clean build host. GitHub/npm accounts and pinned tooling remain trust roots. |
| Maintainer access    | CODEOWNERS identifies sensitive changes; release docs require branch checks, restricted release tags/environments, 2FA and restricted npm publishing. Environment reviewers are optional for automatic releases.                                                                    | Account/repository settings need separate configuration. Files alone do not enforce them.                                         |

Public source is intentionally MIT licensed. Source maps are useful in many
open-source projects and are not inherently unsafe. This package deliberately
excludes `.map` files, inline maps, `sourcesContent`, source URLs, agent state,
environment files and test artifacts. Review the exact inventory when adding a
module; never widen it simply to accept unexpected build output.

## Updates and toolchain policy

Use Node 22.23.4+, 24.22.1+, or 26.12.1+ on their respective release lines. These
patch floors follow the [October 21 Node security advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases),
which includes DNS/TLS and Brotli fixes. Builds, tests and npm share the runtime.
`.nvmrc` pins 24.22.1; review newer security releases regularly.

Development needs npm 11.19+; CI bootstraps an exact npm version outside the
checkout. The seven-day npm age setting uses **days**, not minutes. This is a
repository policy, not a configuration imposed on consumers. See
[npm configuration](https://docs.npmjs.com/cli/using-npm/config/) and
[Dependabot cooldown behavior](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).
Dependabot security updates are not held by its routine-update cooldown; npm's
filter may still need a narrow exception for a fresh security fix.

1. Verify updates on the publisher's primary source. Review package identity,
   maintainer changes, transitive lockfile diff, integrity and install scripts.
2. Use a disposable environment without publishing tokens, signing material,
   SSH/cloud credentials or AI tool auth state. Review commands from issues or
   articles before running them.
3. Keep script blocking enabled. If a verified urgent fix is too new, document
   the package/version, advisory, reason, narrow age exception and removal date
   in the PR. Avoid blanket `--min-release-age=0` or `npm audit fix --force`.
4. Run policy, audit, applicable tests and exact-artifact checks. Inspect the
   release diff; a green audit is not malware proof.

## Response to a suspected compromise

Stop publication and preserve versions, lockfile, tarball hashes and CI logs
without copying credentials into an issue. Establish whether code was downloaded
or executed, including imports/build tools. Isolate an affected runner/workstation;
deleting `node_modules` alone is not remediation.

If malicious code accessed credentials, revoke/rotate affected access from a clean
environment, review npm publishers and workflows, and rebuild on a clean runner.
Follow the primary advisory. The GitHub malware advisories above warn that removal
may leave other malware. Never read real credentials merely to test safeguards;
our regression fixtures use synthetic values.

For an affected release, follow [SECURITY.md](../SECURITY.md), notify users through
an advisory, deprecate the affected version where appropriate, and publish a new
reviewed version. Do not silently replace a version or tag. See
[releasing](releasing.md), [performance](performance.md), and [AGENTS.md](../AGENTS.md).
