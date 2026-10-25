import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateRelease } from '../scripts/check-release.mjs';
import { requestPublication } from '../scripts/request-publication.mjs';
import { checkNpmVersion } from '../scripts/check-npm-version.mjs';
import { checkPublished } from '../scripts/check-published.mjs';
import {
    syncReleaseChoice,
    updateReleaseChoice,
} from '../scripts/sync-release-version.mjs';

const dropdownFixture = `name: Publication fixture
on:
  workflow_dispatch:
    inputs:
      # BEGIN version from package.json (npm run release:sync)
      version:
        type: string
        default: '0.0.1'
      # END version from package.json
permissions:
  contents: read
jobs:
  publish:
    environment: npm
`;

test('generates only the committed version choice and preserves the surrounding workflow', () => {
    for (const eol of ['\n', '\r\n']) {
        const workflow = dropdownFixture.replaceAll('\n', eol);
        const updated = updateReleaseChoice(workflow, '2.4.6');
        assert.ok(
            updated.startsWith(
                workflow.slice(0, workflow.indexOf('      # BEGIN')),
            ),
        );
        assert.ok(
            updated.endsWith(workflow.slice(workflow.indexOf('      # END'))),
        );
        assert.ok(
            updated.includes(
                `        type: choice${eol}        default: '2.4.6'${eol}        options:${eol}          - '2.4.6'${eol}`,
            ),
        );
        assert.doesNotMatch(updated, /0\.0\.1/);
        assert.equal(updateReleaseChoice(updated, '2.4.6'), updated);
    }
});

test('refuses malformed version sources and ambiguous generated sections', () => {
    for (const version of [
        undefined,
        1,
        '',
        '1.2',
        'v1.2.3',
        '1.2.3-beta',
        '01.2.3',
        '1.2.3\n',
        "1.2.3'\npermissions: write-all",
    ]) {
        assert.throws(() => updateReleaseChoice(dropdownFixture, version));
    }
    for (const workflow of [
        dropdownFixture.replace('      # BEGIN', '      # missing BEGIN'),
        dropdownFixture.replace('      # END', '      # missing END'),
        dropdownFixture + dropdownFixture,
        dropdownFixture.split('\n').reverse().join('\n'),
    ]) {
        assert.throws(() => updateReleaseChoice(workflow, '1.2.3'), /marker/);
    }
});

test('checks the package version without writing and syncs after a version bump', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mixtape-release-choice-'));
    const workflowPath = join(directory, '.github/workflows/publish.yml');
    const metadataPath = join(directory, 'package.json');
    try {
        await mkdir(join(directory, '.github/workflows'), { recursive: true });
        await writeFile(metadataPath, JSON.stringify({ version: '1.0.3' }));
        await writeFile(workflowPath, dropdownFixture);
        await assert.rejects(
            syncReleaseChoice(directory, { check: true }),
            /npm run release:sync/,
        );
        assert.equal(await readFile(workflowPath, 'utf8'), dropdownFixture);
        assert.equal(await syncReleaseChoice(directory), '1.0.3');
        assert.equal(
            await syncReleaseChoice(directory, { check: true }),
            '1.0.3',
        );
        await writeFile(metadataPath, JSON.stringify({ version: '1.1.0' }));
        await assert.rejects(
            syncReleaseChoice(directory, { check: true }),
            /stale/,
        );
        await syncReleaseChoice(directory);
        const updated = await readFile(workflowPath, 'utf8');
        assert.match(updated, /default: '1\.1\.0'/);
        assert.doesNotMatch(updated, /1\.0\.3/);
        await syncReleaseChoice(directory, { check: true });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

function fixture() {
    return {
        metadata: { name: 'playwright-mixtape-reporter', version: '1.0.2' },
        lock: { version: '1.0.2', packages: { '': { version: '1.0.2' } } },
        event: {
            repository: {
                full_name: 'yuriidrapak/playwright-mixtape-reporter',
                private: false,
            },
            inputs: { version: '1.0.2' },
        },
        env: {
            GITHUB_EVENT_NAME: 'workflow_dispatch',
            GITHUB_REPOSITORY: 'yuriidrapak/playwright-mixtape-reporter',
            GITHUB_REF: 'refs/heads/main',
            GITHUB_SHA: 'a'.repeat(40),
            GITHUB_ACTOR: 'yuriidrapak',
            GITHUB_TRIGGERING_ACTOR: 'yuriidrapak',
            GH_TOKEN: 'synthetic-workflow-credential',
            RELEASE_GITHUB_TOKEN: 'synthetic-tag-credential',
        },
    };
}

function npmVersions(versions = ['1.0.1'], latest = versions.at(-1)) {
    return [
        200,
        {
            name: 'playwright-mixtape-reporter',
            versions: Object.fromEntries(
                versions.map((version) => [version, {}]),
            ),
            'dist-tags': { latest },
        },
    ];
}

function fakeApi(responses) {
    const calls = [];
    const fetcher = async (url, options) => {
        calls.push({
            url,
            ...options,
            body: options.body ? JSON.parse(options.body) : undefined,
        });
        assert.ok(responses.length, 'Unexpected API request');
        const [status, body] = responses.shift();
        return new Response(
            status === 204 ? null : JSON.stringify(body ?? {}),
            { status },
        );
    };
    return { calls, fetcher };
}

test('manual publication requires the exact stable version, public repository and immutable tag', () => {
    const { metadata, event, env } = fixture();
    env.GITHUB_REF = 'refs/tags/v1.0.2';
    assert.equal(validateRelease(metadata, event, env), 'v1.0.2');
    for (const version of [
        '1.0.3',
        'v1.0.2',
        '1.0.2-beta.1',
        '01.0.2',
        '1.0.2\n',
        '$(echo unsafe)',
        '',
    ]) {
        assert.throws(() =>
            validateRelease(metadata, { ...event, inputs: { version } }, env),
        );
    }
    assert.throws(
        () =>
            validateRelease(metadata, event, {
                ...env,
                GITHUB_EVENT_NAME: 'release',
            }),
        /manually/,
    );
    for (const ref of [
        'refs/heads/main',
        'refs/heads/feature',
        'refs/tags/v1.0.3',
    ]) {
        assert.throws(
            () => validateRelease(metadata, event, { ...env, GITHUB_REF: ref }),
            /immutable release tag/,
        );
    }
    assert.throws(
        () =>
            validateRelease(
                metadata,
                {
                    ...event,
                    repository: { ...event.repository, private: true },
                },
                env,
            ),
        /public/,
    );
    assert.throws(() =>
        validateRelease(
            metadata,
            {
                ...event,
                repository: { ...event.repository, full_name: 'other/repo' },
            },
            env,
        ),
    );
});

test('main request rejects unmerged versions and unauthorized reruns before any API call', async () => {
    for (const change of [
        (input) => {
            input.metadata.version = '1.0.1';
        },
        (input) => {
            input.lock.packages[''].version = '1.0.1';
        },
        (input) => {
            input.env.GITHUB_REF = 'refs/heads/feature';
        },
        (input) => {
            input.env.GITHUB_ACTOR = 'another-user';
        },
        (input) => {
            input.env.GITHUB_TRIGGERING_ACTOR = 'another-user';
        },
        (input) => {
            input.env.GITHUB_SHA = 'main';
        },
    ]) {
        const input = fixture();
        change(input);
        const mock = fakeApi([]);
        await assert.rejects(
            requestPublication({ ...input, fetcher: mock.fetcher }),
        );
        assert.equal(mock.calls.length, 0);
    }
});

test('creates a tag at the requested main commit and dispatches the same version on that tag', async () => {
    const input = fixture();
    const mock = fakeApi([npmVersions(), [404], [201, {}], [204]]);
    assert.equal(
        await requestPublication({ ...input, fetcher: mock.fetcher }),
        'v1.0.2',
    );
    assert.deepEqual(
        mock.calls.map((call) => call.method),
        ['GET', 'GET', 'POST', 'POST'],
    );
    assert.equal(
        mock.calls[0].url,
        'https://registry.npmjs.org/playwright-mixtape-reporter',
    );
    assert.equal(mock.calls[0].headers.Authorization, undefined);
    assert.deepEqual(mock.calls[2].body, {
        ref: 'refs/tags/v1.0.2',
        sha: input.env.GITHUB_SHA,
    });
    assert.equal(
        mock.calls[2].headers.Authorization,
        `Bearer ${input.env.RELEASE_GITHUB_TOKEN}`,
    );
    assert.equal(
        mock.calls[3].url,
        'https://api.github.com/repos/yuriidrapak/playwright-mixtape-reporter/actions/workflows/publish.yml/dispatches',
    );
    assert.deepEqual(mock.calls[3].body, {
        ref: 'v1.0.2',
        inputs: { version: '1.0.2' },
    });
    assert.equal(
        mock.calls[3].headers.Authorization,
        `Bearer ${input.env.GH_TOKEN}`,
    );
    assert.ok(mock.calls.every((call) => call.redirect === 'error'));
});

test('retries reuse the exact existing tag without tag credentials or mutation', async () => {
    for (const annotated of [false, true]) {
        const input = fixture();
        delete input.env.RELEASE_GITHUB_TOKEN;
        const target = { type: 'commit', sha: input.env.GITHUB_SHA };
        const responses = annotated
            ? [
                  [200, { object: { type: 'tag', sha: 'b'.repeat(40) } }],
                  [200, { object: target }],
                  [204],
              ]
            : [[200, { object: target }], [204]];
        const mock = fakeApi([npmVersions(), ...responses]);
        await requestPublication({ ...input, fetcher: mock.fetcher });
        assert.equal(
            mock.calls.filter((call) => call.method === 'POST').length,
            1,
        );
        assert.match(mock.calls.at(-1).url, /\/dispatches$/);
    }
});

test('conflicting tags, missing credentials and API failures never dispatch or move a tag', async () => {
    const scenarios = [
        {
            responses: [
                [200, { object: { type: 'commit', sha: 'b'.repeat(40) } }],
            ],
            error: /different commit/,
        },
        { responses: [[404]], noToken: true, error: /RELEASE_GITHUB_TOKEN/ },
        {
            responses: [[403, { message: 'synthetic-private-response' }]],
            error: /HTTP 403/,
        },
        {
            responses: [
                [404],
                [403, { message: 'synthetic-private-response' }],
            ],
            error: /HTTP 403/,
        },
    ];
    for (const scenario of scenarios) {
        const input = fixture();
        if (scenario.noToken) delete input.env.RELEASE_GITHUB_TOKEN;
        const mock = fakeApi([npmVersions(), ...scenario.responses]);
        await assert.rejects(
            requestPublication({ ...input, fetcher: mock.fetcher }),
            (error) => {
                assert.match(error.message, scenario.error);
                assert.doesNotMatch(error.message, /synthetic-/);
                return true;
            },
        );
        assert.ok(
            mock.calls.every(
                (call) =>
                    !call.url.endsWith('/dispatches') &&
                    !['PATCH', 'DELETE'].includes(call.method),
            ),
        );
    }
});

test('a failed dispatch is reported instead of claiming publication succeeded', async () => {
    const input = fixture();
    const mock = fakeApi([
        npmVersions(),
        [200, { object: { type: 'commit', sha: input.env.GITHUB_SHA } }],
        [422],
    ]);
    await assert.rejects(
        requestPublication({ ...input, fetcher: mock.fetcher }),
        /HTTP 422/,
    );
});

test('npm version ordering is numeric and considers all stable versions, not just latest', async () => {
    for (const [candidate, published, newest] of [
        ['1.0.10', ['1.0.9', '0.0.0-stage'], '1.0.9'],
        ['2.0.0', ['1.99.99', '2.0.0-beta.1'], '1.99.99'],
        ['1.0.2', ['1.0.1+build.2'], '1.0.1+build.2'],
        ['1.0.0', ['0.0.0-stage'], undefined],
        [
            '9007199254740993.0.0',
            ['9007199254740992.0.0'],
            '9007199254740992.0.0',
        ],
    ]) {
        const mock = fakeApi([npmVersions(published)]);
        assert.equal(
            await checkNpmVersion(
                { ...fixture().metadata, version: candidate },
                { fetcher: mock.fetcher },
            ),
            newest,
        );
        assert.equal(mock.calls.length, 1);
        assert.equal(mock.calls[0].headers.Authorization, undefined);
        assert.equal(mock.calls[0].redirect, 'error');
        assert.ok(mock.calls[0].signal instanceof AbortSignal);
    }
    for (const versions of [
        ['1.0.2'],
        ['1.0.3'],
        ['1.0.10', '1.0.1'],
        ['1.0.2+build'],
    ]) {
        const mock = fakeApi([npmVersions(versions, '1.0.1')]);
        await assert.rejects(
            requestPublication({ ...fixture(), fetcher: mock.fetcher }),
            /must be higher than npm's newest stable version/,
        );
        assert.equal(
            mock.calls.length,
            1,
            'No GitHub API calls before version approval',
        );
    }
});

test('npm lookup failures and malformed metadata prevent tags and dispatches', async () => {
    for (const response of [
        [404, { error: 'synthetic-private-response' }],
        [503, { error: 'synthetic-private-response' }],
        [200, { name: 'another-package', versions: { '1.0.1': {} } }],
        [200, { name: fixture().metadata.name }],
        [200, { name: fixture().metadata.name, versions: [] }],
        [200, { name: fixture().metadata.name, versions: {} }],
        npmVersions(['invalid-version']),
        npmVersions(['1.0.1\n']),
    ]) {
        const mock = fakeApi([response]);
        await assert.rejects(
            requestPublication({ ...fixture(), fetcher: mock.fetcher }),
            (error) => {
                assert.doesNotMatch(error.message, /synthetic-/);
                return true;
            },
        );
        assert.equal(mock.calls.length, 1);
    }
    await assert.rejects(
        requestPublication({
            ...fixture(),
            fetcher: async () => {
                throw new Error('Registry unavailable');
            },
        }),
        /Registry unavailable/,
    );
});

test('the upload gate rechecks version ordering and preserves identical-artifact retries', async () => {
    const { metadata } = fixture();
    const integrity = 'sha512-synthetic-integrity';
    const available = fakeApi([[404], npmVersions()]);
    assert.equal(
        await checkPublished(metadata, integrity, {
            fetcher: available.fetcher,
        }),
        true,
    );
    assert.ok(
        available.calls.every(
            (call) => call.headers.Authorization === undefined,
        ),
    );

    const newerRelease = fakeApi([[404], npmVersions(['1.0.3'])]);
    await assert.rejects(
        checkPublished(metadata, integrity, { fetcher: newerRelease.fetcher }),
        /must be higher/,
    );
    const identical = fakeApi([[200, { ...metadata, dist: { integrity } }]]);
    assert.equal(
        await checkPublished(metadata, integrity, {
            fetcher: identical.fetcher,
        }),
        false,
    );
    assert.equal(identical.calls.length, 1);
    for (const response of [
        [200, { ...metadata, dist: { integrity: 'different' } }],
        [200, { ...metadata, name: 'another-package', dist: { integrity } }],
        [200, { ...metadata, version: '1.0.1', dist: { integrity } }],
        [503, { error: 'unavailable' }],
    ]) {
        const mock = fakeApi([response]);
        await assert.rejects(
            checkPublished(metadata, integrity, { fetcher: mock.fetcher }),
        );
        assert.equal(mock.calls.length, 1);
    }
});
