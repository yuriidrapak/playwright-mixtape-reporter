import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';

const metadata = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const tarball = new URL(
    `../${metadata.name}-${metadata.version}.tgz`,
    import.meta.url,
);
const integrity = `sha512-${createHash('sha512')
    .update(await readFile(tarball))
    .digest('base64')}`;
const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(metadata.name)}/${encodeURIComponent(metadata.version)}`,
    { signal: AbortSignal.timeout(30_000) },
);
let publish = true;
if (response.status !== 404) {
    assert.ok(response.ok, `Registry lookup failed: HTTP ${response.status}`);
    const existing = await response.json();
    assert.equal(
        existing.dist?.integrity,
        integrity,
        'This version already exists with different contents; increment the version',
    );
    publish = false;
}
if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
console.log(
    publish
        ? `Ready to publish ${metadata.name}@${metadata.version}`
        : 'The identical tarball is already published; skipping the upload.',
);
