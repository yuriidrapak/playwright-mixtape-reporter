import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkNpmVersion } from './check-npm-version.mjs';

export async function checkPublished(
    metadata,
    integrity,
    { fetcher = fetch } = {},
) {
    const response = await fetcher(
        `https://registry.npmjs.org/${encodeURIComponent(metadata.name)}/${encodeURIComponent(metadata.version)}`,
        {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'Cache-Control': 'no-cache',
            },
            signal: AbortSignal.timeout(30_000),
            redirect: 'error',
        },
    );
    if (response.status === 404) {
        // Another release may have completed while CI ran. Recheck ordering
        // immediately before publication; an identical retry remains a no-op.
        await checkNpmVersion(metadata, { fetcher });
        return true;
    }
    assert.ok(response.ok, `Registry lookup failed: HTTP ${response.status}`);
    const existing = await response.json();
    assert.equal(
        existing.name,
        metadata.name,
        'Unexpected npm package metadata',
    );
    assert.equal(existing.version, metadata.version, 'Unexpected npm version');
    assert.equal(
        existing.dist?.integrity,
        integrity,
        'This version already exists with different contents; increment the version',
    );
    return false;
}

if (
    process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
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
    const publish = await checkPublished(metadata, integrity);
    if (process.env.GITHUB_OUTPUT)
        await appendFile(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
    console.log(
        publish
            ? `Ready to publish ${metadata.name}@${metadata.version}`
            : 'The identical tarball is already published; skipping the upload.',
    );
}
