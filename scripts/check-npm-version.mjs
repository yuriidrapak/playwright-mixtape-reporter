import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Stable SemVer precedence is numeric; build metadata does not change it.
// Prereleases (including the npm bootstrap stage) are not stable releases.
function stableVersion(version) {
    if (typeof version !== 'string') return undefined;
    const match = version.match(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)?$/,
    );
    if (match?.[0] !== version) return undefined;
    return match.slice(1, 4).map((part) => BigInt(part));
}

function compare(left, right) {
    for (let index = 0; index < 3; index++) {
        if (left[index] > right[index]) return 1;
        if (left[index] < right[index]) return -1;
    }
    return 0;
}

export async function checkNpmVersion(metadata, { fetcher = fetch } = {}) {
    assert.equal(metadata.name, 'playwright-mixtape-reporter');
    const candidate = stableVersion(metadata.version);
    assert.ok(
        candidate && !metadata.version.includes('+'),
        'package.json must contain a stable version without build metadata',
    );
    const response = await fetcher(
        `https://registry.npmjs.org/${encodeURIComponent(metadata.name)}`,
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
    assert.ok(
        response.ok,
        `npm version lookup failed: HTTP ${response.status}`,
    );
    const published = await response.json();
    assert.equal(
        published.name,
        metadata.name,
        'Unexpected npm package metadata',
    );
    assert.ok(
        published.versions &&
            typeof published.versions === 'object' &&
            !Array.isArray(published.versions) &&
            Object.keys(published.versions).length > 0,
        'npm returned no published version inventory',
    );
    let newest;
    let newestParts;
    for (const version of Object.keys(published.versions)) {
        const parts = stableVersion(version);
        const prerelease = version.match(
            /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*(?:\+[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)?$/,
        );
        assert.ok(
            parts || prerelease?.[0] === version,
            'npm returned an invalid published version',
        );
        if (parts && (!newestParts || compare(parts, newestParts) > 0)) {
            newest = version;
            newestParts = parts;
        }
    }
    assert.ok(
        !newestParts || compare(candidate, newestParts) > 0,
        `package.json version ${metadata.version} must be higher than npm's newest stable version ${newest}. Bump both package files, run npm run release:sync, and merge before releasing.`,
    );
    return newest;
}

if (
    process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
    const metadata = JSON.parse(
        await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const newest = await checkNpmVersion(metadata);
    console.log(
        `Verified ${metadata.version} is newer than ${newest ?? 'the npm bootstrap stage'}.`,
    );
}
