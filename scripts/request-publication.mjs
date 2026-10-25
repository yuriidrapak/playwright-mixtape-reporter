import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateRelease } from './check-release.mjs';
import { checkNpmVersion } from './check-npm-version.mjs';

// Run only on reviewed main, without installing or executing project dependencies.
// The short-lived workflow token dispatches; the maintainer token only creates tags.
export async function requestPublication({
    metadata,
    lock,
    event,
    env,
    fetcher = fetch,
}) {
    const tag = validateRelease(metadata, event, env, { fromMain: true });
    assert.equal(metadata.name, 'playwright-mixtape-reporter');
    assert.equal(lock.version, metadata.version);
    assert.equal(lock.packages[''].version, metadata.version);
    assert.match(env.GITHUB_SHA, /^[a-f0-9]{40}$/);
    assert.ok(env.GH_TOKEN, 'Missing workflow token');
    // Read public npm metadata without GitHub credentials before creating a tag
    // or dispatching any workflow. package.json remains the version source.
    await checkNpmVersion(metadata, { fetcher });
    const api = async (method, path, body, token = env.GH_TOKEN) => {
        const response = await fetcher(
            `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`,
            {
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'Content-Type': 'application/json',
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(30_000),
                redirect: 'error',
            },
        );
        if (method === 'GET' && response.status === 404) return undefined;
        // Never echo response bodies or headers: they can contain credentials.
        assert.ok(
            response.ok,
            `GitHub ${method} ${path} failed: HTTP ${response.status}`,
        );
        return response.status === 204 ? undefined : response.json();
    };
    const existing = await api('GET', `git/ref/tags/${tag}`);
    if (existing) {
        let target = existing.object;
        if (target.type === 'tag')
            target = (await api('GET', `git/tags/${target.sha}`)).object;
        assert.equal(
            target.type,
            'commit',
            'Release tag must resolve to a commit',
        );
        assert.equal(
            target.sha,
            env.GITHUB_SHA,
            'Existing tag belongs to a different commit; use a new version, never move a release tag',
        );
    } else {
        assert.ok(
            env.RELEASE_GITHUB_TOKEN,
            'Configure the maintainer RELEASE_GITHUB_TOKEN secret to create protected release tags, or create this tag at the reviewed main commit before retrying',
        );
        await api(
            'POST',
            'git/refs',
            { ref: `refs/tags/${tag}`, sha: env.GITHUB_SHA },
            env.RELEASE_GITHUB_TOKEN,
        );
    }
    // A dispatch on the tag preserves the npm environment's v* restriction and
    // makes the reusable CI, build and provenance all use this exact commit.
    await api('POST', 'actions/workflows/publish.yml/dispatches', {
        ref: tag,
        inputs: { version: metadata.version },
    });
    return tag;
}

if (
    process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
    const metadata = JSON.parse(
        await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const lock = JSON.parse(
        await readFile(
            new URL('../package-lock.json', import.meta.url),
            'utf8',
        ),
    );
    const event = JSON.parse(
        await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
    );
    const tag = await requestPublication({
        metadata,
        lock,
        event,
        env: process.env,
    });
    const message = `Verified the package.json version is newer than npm's published stable versions and requested publication of ${tag}. Follow the tag run in [Publish npm package](https://github.com/${process.env.GITHUB_REPOSITORY}/actions/workflows/publish.yml). This request is not a completed npm publication.\n`;
    console.log(
        `Requested publication of ${tag}; follow the separate tag run.`,
    );
    if (process.env.GITHUB_STEP_SUMMARY)
        await appendFile(process.env.GITHUB_STEP_SUMMARY, message);
}
