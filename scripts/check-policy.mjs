import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

// Query only these non-secret settings, never npm's full configuration.
export function validateNpmScriptEnvironment(env) {
    // npm omits default-valued CLI options from a run-script child's environment.
    // A fresh config query would then rediscover the safe project value instead.
    // These mandatory non-default settings must also be present in npm's snapshot.
    for (const key of ['ignore_scripts', 'save_exact']) {
        const name = `npm_config_${key}`;
        const value = Object.hasOwn(env, name)
            ? env[name]
            : Object.entries(env).find(
                  ([candidate]) => candidate.toLowerCase() === name,
              )?.[1];
        if (value !== 'true')
            throw new Error(
                `Unsafe effective npm setting: ${key.replaceAll('_', '-')}`,
            );
    }
    // min-release-age has envExport:false in npm. Its persisted/environment
    // value is queried below; install commands must explicitly enforce the age.
}

export function validateNpmConfig(cwd, env = process.env) {
    assert.ok(env.npm_execpath, 'Run npm run security to check npm policy');
    const settings = {
        'ignore-scripts': 'true',
        'save-exact': 'true',
        'min-release-age': '7',
        registry: 'https://registry.npmjs.org/',
    };
    let output;
    try {
        output = execFileSync(
            process.execPath,
            [env.npm_execpath, 'config', 'get', ...Object.keys(settings)],
            { cwd, env, encoding: 'utf8', stdio: 'pipe', timeout: 15_000 },
        );
    } catch {
        // npm errors can include configuration values. Do not echo them.
        throw new Error('Unable to verify effective npm policy');
    }
    const effective = new Map(
        output
            .trim()
            .split(/\r?\n/)
            .map((line) => {
                const separator = line.indexOf('=');
                return [line.slice(0, separator), line.slice(separator + 1)];
            }),
    );
    for (const [key, expected] of Object.entries(settings)) {
        const value = effective.get(key);
        const valid =
            key === 'min-release-age'
                ? /^\d+$/.test(value ?? '') && Number(value) >= 7
                : value === expected;
        if (!valid) throw new Error(`Unsafe effective npm setting: ${key}`);
    }
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
    validateNpmScriptEnvironment(process.env);
    validateNpmConfig(new URL('../', import.meta.url));
    console.log(
        `Supply-chain policy passed for ${Object.keys(lock.packages).length - 1} locked dependencies.`,
    );
}
