import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { inspectArtifact } from './artifact-policy.mjs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'mixtape-package-'));
// Use npm's JS entry point so Windows does not need a command shell.
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run with npm run test:package');
const run = (args, cwd = directory) =>
    execFileSync(process.execPath, args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
    });

try {
    let tarball = process.argv[2] ? resolve(process.argv[2]) : undefined;
    if (!tarball) {
        const [packed] = JSON.parse(
            run(
                [
                    npm,
                    'pack',
                    '--json',
                    '--ignore-scripts',
                    '--pack-destination',
                    directory,
                ],
                root,
            ),
        );
        tarball = join(directory, packed.filename);
    }
    const artifact = await inspectArtifact(tarball, metadata.version);
    // Verify the bytes consumers receive, not only npm's planned file listing.
    for (const [file, content] of artifact.files)
        assert.deepEqual(
            content,
            await readFile(join(root, file)),
            `Artifact differs from reviewed build: ${file}`,
        );
    const consumer = {
        name: 'mixtape-package-smoke',
        version: '0.0.0',
        private: true,
        type: 'module',
        devDependencies: metadata.devDependencies,
    };
    const lock = JSON.parse(
        await readFile(join(root, 'package-lock.json'), 'utf8'),
    );
    lock.name = consumer.name;
    lock.version = consumer.version;
    lock.packages[''] = {
        name: consumer.name,
        version: consumer.version,
        devDependencies: consumer.devDependencies,
    };
    await writeFile(join(directory, 'package.json'), JSON.stringify(consumer));
    await writeFile(join(directory, 'package-lock.json'), JSON.stringify(lock));
    // A fresh npm ci cache contains tarballs, not necessarily peer/age metadata.
    // Keep the reviewed lockfile, permit metadata fetches, and check every resolved
    // dependency before executing any installed code. Lifecycle scripts stay off.
    run([
        npm,
        'install',
        '--prefer-offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--min-release-age=7',
        '--save-dev',
        tarball,
    ]);
    const installed = JSON.parse(
        await readFile(join(directory, 'package-lock.json'), 'utf8'),
    );
    for (const [path, dependency] of Object.entries(installed.packages)) {
        if (!path || path === `node_modules/${metadata.name}`) continue;
        const expected = lock.packages[path];
        assert.ok(expected, `Unreviewed consumer dependency: ${path}`);
        for (const field of [
            'version',
            'resolved',
            'integrity',
            'link',
            'hasInstallScript',
        ])
            assert.deepEqual(
                dependency[field],
                expected[field],
                `Consumer dependency changed: ${path} (${field})`,
            );
    }
    const nodeModules = join(directory, 'node_modules');
    assert.equal(
        run([
            '--input-type=module',
            '-e',
            "import Reporter from 'playwright-mixtape-reporter'; import { test, expect } from 'playwright-mixtape-reporter/metrics'; console.log(typeof Reporter, typeof test, typeof expect)",
        ]).trim(),
        'function function function',
    );
    assert.equal(
        run([
            '-e',
            "console.log(typeof require('playwright-mixtape-reporter').default)",
        ]).trim(),
        'function',
    );
    await writeFile(
        join(directory, 'types.mts'),
        `import Reporter, { type MixtapeReporterOptions } from 'playwright-mixtape-reporter';
import { test, expect, WorkerMetrics } from 'playwright-mixtape-reporter/metrics';
const options = { colorMode: 'bw', outputFile: false } satisfies MixtapeReporterOptions;
new Reporter(options);
test('types', async ({ mixtapeMetrics }) => { const metrics: WorkerMetrics | undefined = mixtapeMetrics; expect(metrics).toBeDefined(); });
`,
    );
    run([
        join(nodeModules, 'typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--module',
        'NodeNext',
        '--target',
        'ES2022',
        '--types',
        'node',
        'types.mts',
    ]);
    await writeFile(
        join(directory, 'smoke.spec.ts'),
        "import { test, expect } from 'playwright-mixtape-reporter/metrics';\ntest('packaged reporter works', () => expect(2 + 2).toBe(4));\n",
    );
    for (const [extension, contents] of [
        [
            'mjs',
            "export default { reporter: [['playwright-mixtape-reporter', { colorMode: 'bw', outputFile: false }]] };",
        ],
        [
            'cjs',
            "module.exports = { reporter: [['playwright-mixtape-reporter', { colorMode: 'bw', outputFile: false }]] };",
        ],
    ]) {
        const config = `playwright.config.${extension}`;
        await writeFile(join(directory, config), contents);
        const output = run([
            join(nodeModules, '@playwright/test/cli.js'),
            'test',
            '--config',
            config,
            '--workers=1',
        ]);
        assert.match(output, /passed: 1/);
        assert.equal(output.includes('\u001b'), false);
    }
    console.log(
        `Package verified: ${basename(tarball)} (${artifact.size} bytes compressed; ${artifact.files.size} files). ESM, CommonJS config, declarations, metrics export, and real Playwright execution passed.`,
    );
} finally {
    await rm(directory, { recursive: true, force: true });
}
