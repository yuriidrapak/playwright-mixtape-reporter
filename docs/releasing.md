# Publishing to npm

The package name is `playwright-mixtape-reporter`; the first npm release is `1.0.1`.
Build and test the exact tarball before publication. Building/packing does not
publish anything. Never commit registry tokens or give them to build tools.

Publication is manual: **Actions → Publish npm package → Run workflow**. Select
`main`, enter the version already committed in `package.json` (for example
`1.0.2`), and click **Run workflow**. GitHub controls the button's label. Merging
a PR, pushing a tag, or publishing a GitHub Release does not start npm publication.
The form does not bump versions or open PRs.

## Prepare the public project

- Review source and Git history for private data, then make the repository public.
  The workflow rejects private repositories because this project requires public
  GitHub provenance.
- Push reviewed source, lockfile and workflows. Require the full CI matrix on
  `main` and protect release tags. Enable required code-owner review when another
  maintainer can review changes; CODEOWNERS alone is advisory.
- Use two separate active tag rulesets targeting `v*`: one restricts creation
  with only the release maintainer (`yuriidrapak`) allowed to bypass it; the other
  restricts updates/deletions with **no bypass actors**. Do not add the maintainer
  to the immutable-tag rule. A tag's workflow can be changed on its commit, so a
  main-ancestry check inside that workflow is not an independent authorization
  boundary. This separation keeps manually requested publication gated on tests while
  preventing other repository writers from creating release tags. Review the
  creation allowlist deliberately when adding a release maintainer or automation.
- Use GitHub's no-reply email for public commits. Do not merge private prototype
  history into the public repository. Squashing a branch does not remove GitHub
  pull-request references or cached commits.
- Before staging or publishing, review the npm account's public contact email.
  npm adds that email to package metadata independently of GitHub's no-reply
  setting. Use a working, verified public contact alias if desired. Updating the
  account email does not remove the old address from existing version metadata.
  See [npm's metadata privacy guidance](https://docs.npmjs.com/threats-and-mitigations/).
- Enable private vulnerability reporting, Dependabot alerts and available secret
  scanning/push protection. Create the `npm` deployment environment restricted to
  release tags where supported. To finish a manual request after tests, leave the
  manual reviewer gate off; add reviewers if you want a separate human approval.
- Protect GitHub/npm accounts with 2FA, preferably a security key/passkey. Keep MIT
  license/repository metadata aligned. Date the changelog when releasing; use a new
  version for every distinct published artifact.

## Build a release candidate

Use a clean checkout of the reviewed commit in a disposable environment without
publishing/signing credentials:

```sh
nvm install
nvm use
npm run security
npm ci --ignore-scripts
npm run check
npx --no-install playwright install chromium
npm run test:browser
npm audit --audit-level=high
npm run pack
npm run test:package -- ./playwright-mixtape-reporter-1.0.1.tgz
```

Use the current version in the filename. `npm run pack` cleans/builds, inspects
archive bytes, and prints SHA-256. The next command compares all files to the build
and exercises a fresh consumer with ESM and CommonJS configs. Do not edit, rebuild
or repack after testing. Bare `npm pack` does not run these checks; lifecycle hooks
are deliberately absent.

The inventory rejects unreviewed files, links, debug material, common credential
patterns and oversized artifacts. Review the source/build diff too: checks cannot
prove arbitrary compiled code benign. See [incident analysis](supply-chain-security.md).

## First publication through GitHub Actions

npm requires an existing package before trusted publishing can be configured.
Reserve the new name with a temporary staged bootstrap, then publish the real
release through the tested GitHub workflow. This gives the first stable release
GitHub provenance without putting an npm token in CI.

1. Enable npm account 2FA and complete `npm login` in a clean publication
   environment. Check the name immediately before staging; a previous 404 does
   not reserve it.
2. Prepare an isolated bootstrap directory containing only `package.json`, a
   short README stating that this stage must never be approved, and the MIT
   license. Use this package name, version `0.0.0`, the correct repository URL,
   and no scripts or dependencies. Pack with `npm pack --ignore-scripts`; inspect
   all three text files before submitting it.
3. Stage that bootstrap tarball:

   ```sh
   npm stage publish ./playwright-mixtape-reporter-0.0.0.tgz --ignore-scripts --access public --tag bootstrap
   ```

   Record the returned stage ID. npm creates a public `0.0.0-stage` placeholder
   for a new package; the staged `0.0.0` contents are not public. **Never approve
   the bootstrap stage.** This is a registry change, not a dry run.

4. Configure the trusted publisher below, with direct publishing allowed.
5. Run **Publish npm package** on `main` with version `1.0.1`, following the
   manual publication steps below. The workflow validates every platform, builds
   and tests the release tarball, and publishes `1.0.1` with provenance.
6. Verify the registry artifact and provenance, then remove the unused bootstrap
   stage with `npm stage reject <stage-id>` and complete npm's 2FA prompt. Reject
   only the temporary stage; do not unpublish a released version.

This uses npm's documented [staging behavior for new packages](https://docs.npmjs.com/staged-publishing/)
and [stage commands](https://docs.npmjs.com/cli/v11/commands/npm-stage/).
Staging requires npm 11.15+; the project's baseline exceeds that. Once a stable
version exists, subsequent releases use the workflow directly without bootstrapping.

The registry check skips an identical version on a rerun and rejects different
bytes for an existing version. A version cannot be overwritten. A locally
published bootstrap release would not acquire provenance retroactively by
rerunning the workflow.

## Configure trusted publishing

In npm package settings, add a GitHub Actions trusted publisher matching:

| Field                | Value                         |
| -------------------- | ----------------------------- |
| Organization or user | `yuriidrapak`                 |
| Repository           | `playwright-mixtape-reporter` |
| Workflow filename    | `publish.yml`                 |
| Environment          | `npm`                         |

The equivalent CLI command is:

```sh
npm trust github playwright-mixtape-reporter --file publish.yml --repository yuriidrapak/playwright-mixtape-reporter --environment npm --allow-publish --yes
```

Complete npm's authentication prompt. `--yes` accepts the displayed configuration;
it does not bypass 2FA. Verify it with `npm trust list playwright-mixtape-reporter`.
See [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

Use a GitHub-hosted runner. Configure when ready to validate it: npm currently
requires a successful publication within two days. The workflow publishes
directly; configure compatible publisher permissions. For stage-only permissions,
first change the final command to staged publication and document maintainer
approval; otherwise direct publishing fails. After validating OIDC, select
**Require two-factor authentication and disallow tokens** in npm settings and
revoke unneeded publishing tokens. No `NPM_TOKEN` secret is needed.
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

## Configure the manual Actions form

Merge `publish.yml` and its release scripts into `main` before using the form.
GitHub only displays **Run workflow** when `workflow_dispatch` is present on the
default branch. The request job accepts only `main` runs initiated and rerun by
the release maintainer, `yuriidrapak`.

To let the button create a protected `vX.Y.Z` tag, add an Actions repository secret
named `RELEASE_GITHUB_TOKEN`: a fine-grained GitHub token owned by `yuriidrapak`,
limited to this repository, with **Contents: read and write** and an expiration.
The existing tag-creation allowlist must permit that maintainer. Keep the
update/deletion ruleset immutable with no bypass actors. This is a GitHub tag
credential; npm still uses OIDC and needs no npm token. The token is provided only
to the request step, which installs no dependencies and executes no package code.
Protect workflow/script changes and rotate or revoke this token when needed.

Alternatively, create the tag yourself at the reviewed `main` commit before
clicking the button; an existing matching tag requires no extra secret. An
existing tag pointing to any other commit is rejected and never moved. If GitHub
rejects tag creation, check the token's repository access and tag rules rather
than relaxing the immutable-tag rules.

The request uses the built-in `GITHUB_TOKEN` with `actions: write` to dispatch the
same workflow on the tag. This produces two runs: a short request run on `main`
and the actual publication run on `vX.Y.Z`. A successful request only means the
publication run was queued. Follow the tag run through its final publish job.
This keeps the `npm` environment restricted to `v*` tags and ensures reusable CI,
the build, and npm provenance all use the same release commit. No repository
settings are changed by the workflow.

References: [manual workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event),
and [creating Git references](https://docs.github.com/en/rest/git/refs#create-a-reference).

## Subsequent stable releases

1. Update with `npm version patch --no-git-tag-version` (or minor/major), update
   the changelog, and merge the reviewed change to protected `main`.
2. Confirm CI passed and review npm's public account contact email. Open
   **Actions → Publish npm package → Run workflow**, select `main`, enter
   `X.Y.Z` without a `v` prefix, and click **Run workflow**. The version must match
   both package files on that commit. The request creates or verifies `vX.Y.Z`
   and dispatches publication on the tag; it does not modify source or create a
   GitHub Release. You may add a GitHub Release with notes separately.
3. The tag run invokes the reusable CI workflow for the exact release commit:
   all Node/platform checks, dependency audits and Chromium must succeed. Only
   then does the build job verify public source, version and main ancestry,
   install without scripts, pack and test the exact tarball, check registry state,
   and upload only that tarball with its SHA-256. Validation/build have read-only
   repository permissions and no npm environment/OIDC rights.
4. Publish job: use the protected `npm` environment, download the artifact, verify
   filename/tag and SHA-256, then publish the explicit local path
   `./release/<filename>` with
   `--ignore-scripts --access public --provenance`. This job does not check out
   source, install project dependencies, build, or execute the package. Without the leading `./`, npm can interpret a path as GitHub shorthand. No shared
   dependency cache is restored. Actions are pinned to full commit SHAs.
5. Verify npm version, provenance link and downloaded tarball integrity. Test
   installation in a separate consumer environment without publishing credentials.

For a failed publication, investigate the failed gate and rerun the **tag run**.
If the request failed after creating the tag, rerunning that request reuses the
same tag only when its commit matches. Do not rerun from a newer `main` commit
with the old version. The existing registry check skips an already published,
identical tarball and rejects different contents for that version.

The digest protects transfer between jobs, not the build host. Review workflows,
dependencies and account permissions. Only stable releases are supported. Never
delete/recreate a published tag to change its meaning. Investigate failed gates
before retrying; do not bypass them. See
[npm provenance](https://docs.npmjs.com/generating-provenance-statements/).
