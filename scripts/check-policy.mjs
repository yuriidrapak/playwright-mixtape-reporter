import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateDependencies(metadata, lock) {
    for (const field of [
        'dependencies',
        'optionalDependencies',
        'bundledDependencies',
        'bundleDependencies',
    ])
        assert.ok(
            !metadata[field] || Object.keys(metadata[field]).length === 0,
            `Unexpected runtime dependency field: ${field}`,
        );
    assert.equal(lock.lockfileVersion, 3);
    assert.equal(lock.name, metadata.name);
    assert.equal(lock.version, metadata.version);
    for (const key of ['devDependencies', 'peerDependencies', 'engines'])
        assert.deepEqual(lock.packages[''][key], metadata[key]);
    for (const version of Object.values(metadata.devDependencies))
        assert.match(
            version,
            /^\d+\.\d+\.\d+$/,
            'Development dependencies must be exact stable versions',
        );
    const forbidden = new Set([
        'plain-crypto-js',
        'codexui-android',
        'codex-setup',
        'api-anthropic',
    ]);
    for (const [path, dependency] of Object.entries(lock.packages)) {
        if (!path) continue;
        const name = path.split('node_modules/').at(-1);
        assert.ok(!forbidden.has(name), `Blocked incident package: ${name}`);
        assert.ok(
            !(
                name === 'axios' &&
                ['1.14.1', '0.30.4'].includes(dependency.version)
            ),
            'Blocked Axios incident version',
        );
        assert.ok(
            !dependency.link &&
                !dependency.inBundle &&
                !dependency.hasInstallScript,
            `Unexpected linked, bundled, or install-script dependency: ${path}`,
        );
        const url = new URL(dependency.resolved);
        assert.equal(
            url.origin,
            'https://registry.npmjs.org',
            `Unapproved dependency registry: ${path}`,
        );
        assert.equal(
            decodeURIComponent(url.pathname),
            `/${name}/-/${name.split('/').at(-1)}-${dependency.version}.tgz`,
            `Dependency tarball identity mismatch: ${path}`,
        );
        assert.ok(
            !url.username && !url.password && !url.search && !url.hash,
            `Unexpected dependency URL: ${path}`,
        );
        assert.match(
            dependency.integrity,
            /^sha512-[A-Za-z0-9+/]{86}==$/,
            `Missing SHA-512 integrity: ${path}`,
        );
    }
}

export function validateRuntime(node, npm) {
    const [major, minor, patch] = node.split('.').map(Number);
    const minimum =
        major === 22
            ? [23, 4]
            : major === 24
              ? [22, 1]
              : major === 26
                ? [12, 1]
                : undefined;
    assert.ok(
        major > 26 ||
            (minimum &&
                (minor > minimum[0] ||
                    (minor === minimum[0] && patch >= minimum[1]))),
        'Use security-patched Node 22.23.4, 24.22.1, 26.12.1 or newer supported lines',
    );
    const [npmMajor, npmMinor] = npm.split('.').map(Number);
    assert.ok(
        npmMajor > 11 || (npmMajor === 11 && npmMinor >= 19),
        'Development requires npm 11.19+ for release-age controls',
    );
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
    validateDependencies(metadata, lock);
    validateRuntime(
        process.versions.node,
        process.env.npm_config_user_agent?.match(/npm\/([\d.]+)/)?.[1] ??
            '0.0.0',
    );
    const config = await readFile(
        new URL('../.npmrc', import.meta.url),
        'utf8',
    );
    for (const setting of [
        'ignore-scripts=true',
        'save-exact=true',
        'min-release-age=7',
        'registry=https://registry.npmjs.org/',
    ])
        assert.ok(
            config.split(/\r?\n/).includes(setting),
            `Missing npm policy: ${setting}`,
        );
    console.log(
        `Supply-chain policy passed for ${Object.keys(lock.packages).length - 1} locked dependencies.`,
    );
}
