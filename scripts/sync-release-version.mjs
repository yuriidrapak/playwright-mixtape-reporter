import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const begin = '      # BEGIN version from package.json (npm run release:sync)';
const end = '      # END version from package.json';

// GitHub renders choice options before any job can read package.json. Generate
// only this marked input block, and require it to be committed with version bumps.
export function updateReleaseChoice(workflow, version) {
    assert.equal(typeof version, 'string', 'Missing package version');
    assert.equal(
        version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)?.[0],
        version,
        'The release dropdown requires a stable package version',
    );
    const eol = workflow.includes('\r\n') ? '\r\n' : '\n';
    const lines = workflow.split(eol);
    assert.equal(
        lines.filter((line) => line === begin).length,
        1,
        'Expected one release version begin marker',
    );
    assert.equal(
        lines.filter((line) => line === end).length,
        1,
        'Expected one release version end marker',
    );
    const start = lines.indexOf(begin);
    const finish = lines.indexOf(end);
    assert.ok(finish > start, 'Release version markers are reversed');
    const block = [
        begin,
        '      version:',
        '        description: Ready-to-publish version from package.json',
        '        required: true',
        '        type: choice',
        `        default: '${version}'`,
        '        options:',
        `          - '${version}'`,
        end,
    ];
    return [
        ...lines.slice(0, start),
        ...block,
        ...lines.slice(finish + 1),
    ].join(eol);
}

export async function syncReleaseChoice(directory, { check = false } = {}) {
    const metadata = JSON.parse(
        await readFile(join(directory, 'package.json'), 'utf8'),
    );
    const path = join(directory, '.github/workflows/publish.yml');
    const workflow = await readFile(path, 'utf8');
    const updated = updateReleaseChoice(workflow, metadata.version);
    if (check) {
        assert.ok(
            workflow === updated,
            'Publish dropdown is stale. Run npm run release:sync and commit publish.yml with the version bump.',
        );
    } else if (workflow !== updated) {
        await writeFile(path, updated);
    }
    return metadata.version;
}

if (
    process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
    assert.ok(
        process.argv.length === 2 ||
            (process.argv.length === 3 && process.argv[2] === '--check'),
        'Usage: node scripts/sync-release-version.mjs [--check]',
    );
    const check = process.argv[2] === '--check';
    const version = await syncReleaseChoice(
        fileURLToPath(new URL('../', import.meta.url)),
        { check },
    );
    console.log(
        `Publish dropdown ${check ? 'verified' : 'synced'}: ${version} from package.json`,
    );
}
