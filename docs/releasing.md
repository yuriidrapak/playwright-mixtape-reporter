# Publishing to npm

The package name is `playwright-mixtape-reporter`; the first npm release is `1.0.1`.
Build and test the exact tarball before publication. Building/packing does not
publish anything. Never commit registry tokens or give them to build tools.

## Prepare the public project

- Review source and Git history for private data, then make the repository public.
  The workflow rejects private repositories because this project requires public
  GitHub provenance.
- Push reviewed source, lockfile and workflows. Require the full CI matrix on
  `main` and protect release tags. Enable required code-owner review when another
  maintainer can review changes; CODEOWNERS alone is advisory.
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
  release tags where supported. For automatic publication after tests, leave the
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
5. Create the real `v1.0.1` GitHub release at the reviewed commit on `main`.
   The workflow validates every platform, builds and tests the release tarball,
   and publishes `1.0.1` with provenance.
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

## Subsequent stable releases

1. Update with `npm version patch --no-git-tag-version` (or minor/major), update
   the changelog, and merge the reviewed change to protected `main`.
2. Confirm CI passed. Tag that commit `vX.Y.Z` and publish a non-draft,
   non-prerelease GitHub release for it.
3. The release invokes the reusable CI workflow for the exact release commit:
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

The digest protects transfer between jobs, not the build host. Review workflows,
dependencies and account permissions. Only stable releases are supported. Never
delete/recreate a published tag to change its meaning. Investigate failed gates
before retrying; do not bypass them. See
[npm provenance](https://docs.npmjs.com/generating-provenance-statements/).
