import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const metadata = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
assert.match(
    metadata.version,
    /^\d+\.\d+\.\d+$/,
    'This workflow publishes stable versions only',
);
assert.equal(
    process.env.GITHUB_REF,
    `refs/tags/v${metadata.version}`,
    'Release tag must match package.json',
);
assert.equal(
    process.env.GITHUB_REPOSITORY,
    'yuriidrapak/playwright-mixtape-reporter',
);
assert.ok(process.env.GITHUB_EVENT_PATH, 'Missing GitHub event');
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
assert.equal(
    event.repository.private,
    false,
    'Make the source repository public before publishing with provenance',
);
assert.equal(event.release?.prerelease, false);
assert.equal(event.release?.draft, false);
console.log(`Verified stable public release v${metadata.version}`);
