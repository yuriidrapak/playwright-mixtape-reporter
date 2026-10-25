import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateRelease(
    metadata,
    event,
    env,
    { fromMain = false } = {},
) {
    assert.equal(
        env.GITHUB_EVENT_NAME,
        'workflow_dispatch',
        'Publication must be requested manually',
    );
    assert.equal(
        env.GITHUB_REPOSITORY,
        'yuriidrapak/playwright-mixtape-reporter',
    );
    assert.equal(event.repository.full_name, env.GITHUB_REPOSITORY);
    assert.equal(
        event.repository.private,
        false,
        'Make the source repository public before publishing with provenance',
    );
    assert.match(
        event.inputs.version,
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
        'Enter a stable version such as 1.0.2, without a v prefix',
    );
    assert.equal(
        metadata.version,
        event.inputs.version,
        'Selected version must already be committed in package.json',
    );
    const tag = `v${metadata.version}`;
    assert.equal(
        env.GITHUB_REF,
        fromMain ? 'refs/heads/main' : `refs/tags/${tag}`,
        'Publication must use main or its matching immutable release tag',
    );
    if (fromMain) {
        assert.equal(env.GITHUB_ACTOR, 'yuriidrapak');
        assert.equal(env.GITHUB_TRIGGERING_ACTOR, 'yuriidrapak');
    }
    return tag;
}

if (
    process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
    const metadata = JSON.parse(
        await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    assert.ok(process.env.GITHUB_EVENT_PATH, 'Missing GitHub event');
    const event = JSON.parse(
        await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
    );
    const tag = validateRelease(metadata, event, process.env);
    console.log(`Verified manually requested public release ${tag}`);
}
