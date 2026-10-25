import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { command, ttyCommand, packageDir, reporter } from './support.ts';
import { stripVTControlCharacters } from 'node:util';

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));

test(
    'shows all 10 real Playwright runners concurrently in a pseudo-terminal',
    {
        timeout: 45_000,
        skip:
            process.platform === 'win32'
                ? 'Requires a POSIX pseudo-terminal'
                : false,
    },
    async () => {
        const dir = await mkdtemp(join(packageDir, '.smoke-'));
        try {
            const barrier = join(dir, 'barrier');
            await mkdir(barrier);
            const config = join(dir, 'playwright.config.ts');
            await writeFile(
                config,
                `export default {
            testDir: ${JSON.stringify(fixturesDir)},
            testMatch: 'runners.spec.ts',
            outputDir: ${JSON.stringify(join(dir, 'output'))},
            fullyParallel: true,
            workers: 10,
            timeout: 20_000,
            reporter: [['${reporter}', { colorMode: 'color', showMetrics: true }]],
        };`,
            );
            const execution = await ttyCommand(
                ['test', '--config', config],
                packageDir,
                {
                    MIXTAPE_REPORTER_TEST_BARRIER: barrier,
                    MIXTAPE_REPORTER_TEST_WORKERS: '10',
                },
            );
            assert.equal(execution.code, 0, execution.output);
            const output = stripVTControlCharacters(execution.output);
            // All ten barrier-controlled lanes must appear before any result is printed.
            // The count itself arrives as cell patches, not a repeated full header.
            const firstResult = output.indexOf('✅ Reporter runner');
            assert.ok(firstResult > 0);
            const running = output.slice(0, firstResult);
            for (let slot = 1; slot <= 10; slot++)
                assert.match(running, new RegExp(`Reporter runner ${slot}\\b`));
            assert.match(output, /⟦.-.⟧/);
            assert.match(output, /CPU\(SYS\)/);
            assert.match(output, /NET/);
            assert.match(output, /Mbit\/s/);
            assert.doesNotMatch(
                output,
                /W\d{2}|\bSTATE\b|\bTAKES\b|\bCASSETTE\b/,
            );
            assert.match(output, /passed: 10/);
            assert.match(output, /Pass rate: 10\/10 \(100\.0%\)/);
            assert.ok(
                execution.output.includes('\u001b[0J'),
                'Live rows must clear at final cleanup',
            );
            assert.ok(
                execution.output.includes('\u001b[1L'),
                'Results must retain the existing panel',
            );
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    },
);

test(
    'loads the built npm package in real API/Chrome projects and agrees with JSON results',
    { timeout: 60_000 },
    async () => {
        // Stay inside the checkout so Playwright can resolve its peer dependencies.
        const dir = await mkdtemp(join(packageDir, '.smoke-'));
        try {
            const config = join(dir, 'playwright.config.ts');
            const json = join(dir, 'results.json');
            await writeFile(
                config,
                `export default {
            testDir: ${JSON.stringify(fixturesDir)},
            testMatch: 'outcomes.spec.ts',
            outputDir: ${JSON.stringify(join(dir, 'output'))},
            retries: 1,
            workers: 2,
            use: { trace: 'retain-on-failure' },
            projects: [{ name: 'API' }, { name: 'Chrome' }],
            reporter: [
                ['${reporter}', { colors: false }],
                ['json', { outputFile: ${JSON.stringify(json)} }],
                ['blob', { outputDir: ${JSON.stringify(join(dir, 'blob'))} }],
            ],
        };`,
            );
            const execution = await command(
                ['test', '--config', config],
                packageDir,
            );
            assert.equal(execution.code, 1, execution.output);
            assert.match(execution.output, /Running 16 tests on 2 workers/);
            assert.match(execution.output, /✅ \[API\] › passes/);
            assert.match(execution.output, /✅ \[Chrome\] › passes/);
            assert.match(
                execution.output,
                /🟡 \[API\] › recovers on retry .*attempt 2\/2/,
            );
            assert.match(
                execution.output,
                /passed: 6 .*failed: 6 .*flaky: 2 .*skipped: 2/,
            );
            assert.match(execution.output, /Pass rate: 6\/16 \(37\.5%\)/);
            assert.match(
                execution.output,
                /Reporter fixture intentional failure/,
            );
            assert.doesNotMatch(
                execution.output,
                /worker output retained by JSON reporter/,
            );
            assert.equal(execution.output.includes('\u001b'), false);
            const issueLog = await readFile(
                join(dir, 'test-results/mixtape-reporter/issues.log'),
                'utf8',
            );
            assert.match(issueLog, /failed: 6 \| flaky: 2/);
            assert.match(issueLog, /FLAKY .*recovers on retry/);
            assert.match(
                issueLog,
                /Reporter fixture intentional first-attempt failure/,
            );
            assert.match(issueLog, /failure diagnostic fixture output/);
            assert.match(issueLog, /npx playwright show-trace/);
            const tracePath = issueLog
                .split('\n')
                .find((line) =>
                    /^\s{4}(?:\/|[A-Z]:).*[/]trace\.zip$/.test(
                        line.replaceAll('\\', '/'),
                    ),
                )
                ?.trim();
            assert.ok(
                tracePath,
                'Real retained trace should be linked from the issue log',
            );
            assert.equal(
                (await readFile(tracePath)).subarray(0, 2).toString(),
                'PK',
            );
            const report = JSON.parse(await readFile(json, 'utf8')) as {
                stats: {
                    expected: number;
                    unexpected: number;
                    flaky: number;
                    skipped: number;
                };
            };
            assert.deepEqual(
                [
                    report.stats.expected,
                    report.stats.unexpected,
                    report.stats.flaky,
                    report.stats.skipped,
                ],
                [6, 6, 2, 2],
            );
            assert.match(
                await readFile(json, 'utf8'),
                /worker output retained by JSON reporter/,
            );

            const merged = await command(
                ['merge-reports', '--reporter', reporter, join(dir, 'blob')],
                packageDir,
            );
            assert.equal(merged.code, 0, merged.output);
            assert.match(
                merged.output,
                /passed: 6 .*failed: 6 .*flaky: 2 .*skipped: 2/,
            );

            const flaky = await command(
                [
                    'test',
                    '--config',
                    config,
                    '--grep',
                    'recovers on retry',
                    '--fail-on-flaky-tests',
                ],
                packageDir,
            );
            assert.equal(flaky.code, 1, flaky.output);
            assert.match(
                flaky.output,
                /passed: 0 .*failed: 0 .*flaky: 2 .*skipped: 0/,
            );
            assert.match(flaky.output, /RUN FAILED/);

            const empty = await command(
                [
                    'test',
                    '--config',
                    config,
                    '--grep',
                    'no matching test exists',
                ],
                packageDir,
            );
            assert.equal(empty.code, 1, empty.output);
            assert.match(empty.output, /Global error:/);
            assert.match(empty.output, /Global errors: 1/);
            assert.match(empty.output, /Pass rate: 0\/0 \(0\.0%\)/);

            const bw = await command(
                [
                    'test',
                    '--config',
                    config,
                    '--grep',
                    'captures stdout',
                    '--reporter',
                    reporter,
                ],
                packageDir,
                {
                    PLAYWRIGHT_MIXTAPE_COLOR_MODE: 'bw',
                    PLAYWRIGHT_MIXTAPE_SHOW_LOGS: 'true',
                },
            );
            assert.equal(bw.code, 0, bw.output);
            assert.match(bw.output, /Playwright Mixtape Reporter/);
            assert.match(bw.output, /worker output retained by JSON reporter/);
            assert.match(bw.output, /worker stderr retained by JSON reporter/);
            assert.match(bw.output, /\[PASS\] passed: 2/);
            assert.equal(bw.output.includes('\u001b'), false);

            const color = await command(
                [
                    'test',
                    '--config',
                    config,
                    '--grep',
                    'passes$',
                    '--project',
                    'API',
                    '--reporter',
                    reporter,
                ],
                packageDir,
                { PLAYWRIGHT_MIXTAPE_COLOR_MODE: 'color' },
            );
            assert.equal(color.code, 0, color.output);
            assert.ok(color.output.includes('\u001b[38;5;147m'));
            assert.ok(color.output.includes('\u001b[38;5;116m'));
            assert.equal(color.output.includes('\u001b[2K'), false);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    },
);
