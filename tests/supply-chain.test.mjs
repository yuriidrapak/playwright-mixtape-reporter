import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
    expectedFiles,
    readArchive,
    validateFiles,
} from '../scripts/artifact-policy.mjs';
import {
    validateDependencies,
    validateRuntime,
    validateNpmConfig,
} from '../scripts/check-policy.mjs';

function files() {
    const result = new Map(
        [...expectedFiles].map((file) => [file, Buffer.from('fixture')]),
    );
    result.set(
        'package.json',
        Buffer.from(
            JSON.stringify({
                name: 'playwright-mixtape-reporter',
                version: '1.0.0',
                license: 'MIT',
            }),
        ),
    );
    return result;
}

function archive(entries, type = '0') {
    const blocks = [];
    for (const [name, body] of entries) {
        const header = Buffer.alloc(512);
        header.write(`package/${name}`, 0, 100);
        header.write('0000644\0', 100);
        header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
        header.fill(32, 148, 156);
        header.write(type, 156);
        const checksum = header.reduce((sum, byte) => sum + byte, 0);
        header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
        blocks.push(
            header,
            body,
            Buffer.alloc((512 - (body.length % 512)) % 512),
        );
    }
    return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

test('validates archive bytes and rejects maps, private files, traversal, duplicates and links', () => {
    const original = files();
    assert.deepEqual(readArchive(archive(original)), original);
    validateFiles(original, '1.0.0');
    for (const file of [
        'dist/index.js.map',
        '.env',
        'AGENTS.md',
        '../escape.js',
        'dist/hidden.js',
    ])
        assert.throws(
            () =>
                readArchive(
                    archive([...original, [file, Buffer.from('secret')]]),
                ),
            /Unexpected package file/,
        );
    assert.throws(
        () => readArchive(archive([...original, [...original][0]])),
        /Duplicate/,
    );
    assert.throws(() => readArchive(archive(original, '2')), /regular files/);
    const malformed = gunzipSync(archive(original));
    malformed[0] ^= 1;
    assert.throws(() => readArchive(gzipSync(malformed)), /checksum/);
    const truncated = gunzipSync(archive(original)).subarray(0, -512);
    assert.throws(() => readArchive(gzipSync(truncated)), /trailer/);
    assert.throws(
        () => readArchive(gzipSync(Buffer.alloc(1_000_001))),
        /larger than/,
    );
});

test('effective npm policy rejects environment overrides and duplicate config without leaking values', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mixtape-npm-policy-'));
    const config =
        'ignore-scripts=true\nsave-exact=true\nmin-release-age=7\nregistry=https://registry.npmjs.org/\n';
    const env = Object.fromEntries(
        Object.entries(process.env).filter(
            ([key]) => !/^npm_config_/i.test(key),
        ),
    );
    env.NPM_CONFIG_USERCONFIG = join(directory, 'user.npmrc');
    env.NPM_CONFIG_GLOBALCONFIG = join(directory, 'global.npmrc');
    try {
        writeFileSync(env.NPM_CONFIG_USERCONFIG, '');
        writeFileSync(env.NPM_CONFIG_GLOBALCONFIG, '');
        writeFileSync(join(directory, 'package.json'), '{"private":true}');
        writeFileSync(join(directory, '.npmrc'), config);
        validateNpmConfig(directory, env);
        for (const [key, value] of [
            ['ignore-scripts', 'false'],
            ['save-exact', 'false'],
            ['min-release-age', '0'],
            ['registry', 'https://fixture-secret@example.invalid/'],
        ]) {
            for (const prefix of ['npm_config_', 'NPM_CONFIG_']) {
                const variable = prefix + key.replaceAll('-', '_');
                assert.throws(
                    () =>
                        validateNpmConfig(directory, {
                            ...env,
                            [variable]: value,
                        }),
                    (error) => {
                        assert.match(
                            error.message,
                            new RegExp(`Unsafe effective npm setting: ${key}`),
                        );
                        assert.doesNotMatch(
                            error.message,
                            /fixture-secret|example.invalid/,
                        );
                        return true;
                    },
                );
            }
            writeFileSync(
                join(directory, '.npmrc'),
                config + `${key}=${value}\n`,
            );
            assert.throws(
                () => validateNpmConfig(directory, env),
                /Unsafe effective npm setting/,
            );
            writeFileSync(join(directory, '.npmrc'), config);
        }
        validateNpmConfig(directory, {
            ...env,
            npm_config_min_release_age: '14',
        });
        writeFileSync(
            join(directory, 'check.mjs'),
            `import { validateNpmConfig, validateNpmScriptEnvironment } from ${JSON.stringify(new URL('../scripts/check-policy.mjs', import.meta.url).href)};
validateNpmScriptEnvironment(process.env);
validateNpmConfig(process.cwd());
`,
        );
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                scripts: { check: 'node check.mjs' },
            }),
        );
        const run = (flags) =>
            spawnSync(
                process.execPath,
                [env.npm_execpath, ...flags, 'run', 'check'],
                {
                    cwd: directory,
                    env,
                    encoding: 'utf8',
                    timeout: 15000,
                },
            );
        assert.equal(run([]).status, 0);
        for (const flag of ['--ignore-scripts=false', '--save-exact=false']) {
            const child = run([flag]);
            assert.equal(child.status, 1);
            assert.match(child.stderr, /Unsafe effective npm setting/);
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('rejects embedded debug sources, credentials, and unexpected lifecycle code', () => {
    for (const content of [
        '//# sourceMappingURL=data:application/json;base64,e30=',
        '//# sourceURL=/private/src.ts',
        '{"sourcesContent":["private code"]}',
        'npm_' + 'x'.repeat(40),
        'const path = "/Users/private/project";',
    ]) {
        const candidate = files();
        candidate.set('dist/index.js', Buffer.from(content));
        assert.throws(() => validateFiles(candidate, '1.0.0'));
    }
    for (const change of [
        { scripts: { postinstall: 'node payload.js' } },
        { dependencies: { payload: '1.0.0' } },
        { bin: './dist/index.js' },
    ]) {
        const candidate = files();
        const metadata = JSON.parse(candidate.get('package.json'));
        candidate.set(
            'package.json',
            Buffer.from(JSON.stringify({ ...metadata, ...change })),
        );
        assert.throws(() => validateFiles(candidate, '1.0.0'));
    }
});

test('dependency policy rejects off-registry packages, missing integrity and install hooks', () => {
    const metadata = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url)),
    );
    const original = JSON.parse(
        readFileSync(new URL('../package-lock.json', import.meta.url)),
    );
    validateDependencies(metadata, original);
    const key = Object.keys(original.packages).find(Boolean);
    for (const change of [
        { resolved: 'https://example.com/payload.tgz' },
        { resolved: 'https://registry.npmjs.org/payload/-/payload-1.0.0.tgz' },
        { integrity: '' },
        { hasInstallScript: true },
        { link: true },
    ]) {
        const candidate = structuredClone(original);
        Object.assign(candidate.packages[key], change);
        assert.throws(() => validateDependencies(metadata, candidate));
    }
    const blocked = structuredClone(original);
    blocked.packages['node_modules/codex-setup'] = { ...blocked.packages[key] };
    assert.throws(
        () => validateDependencies(metadata, blocked),
        /Blocked incident/,
    );
});

test('runtime policy rejects superseded security baselines and npm without age filtering', () => {
    for (const node of ['22.23.4', '24.22.1', '26.12.1'])
        validateRuntime(node, '11.19.0');
    for (const node of ['20.19.0', '22.18.0', '24.21.0', '25.1.0', '26.12.0'])
        assert.throws(
            () => validateRuntime(node, '11.19.0'),
            /security-patched/,
        );
    assert.throws(() => validateRuntime('24.22.1', '10.9.0'), /npm 11.19/);
});
