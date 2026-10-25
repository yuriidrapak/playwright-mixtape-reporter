import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { command, packageDir, reporter } from './support.ts';
import { MetricsMonitor, metricsEnvironment } from '../src/metrics-monitor.ts';

test(
    'works through the CLI with a real HTTP API and Chromium browser journey',
    { timeout: 60_000 },
    async () => {
        const dir = await mkdtemp(join(packageDir, '.smoke-'));
        const metrics = new MetricsMonitor();
        metrics.start();
        const server = createServer((request, response) => {
            if (request.url === '/health') {
                response.setHeader('Content-Type', 'application/json');
                response.end(JSON.stringify({ status: 'ok' }));
            } else {
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<button onclick="this.textContent=\'Booked\'">Book now</button>',
                );
            }
        });
        try {
            await new Promise<void>((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', resolve);
            });
            const address = server.address();
            assert.ok(address && typeof address !== 'string');
            const baseURL = `http://127.0.0.1:${address.port}`;
            await writeFile(
                join(dir, 'api.spec.ts'),
                `import { test, expect } from 'playwright-mixtape-reporter/metrics';
            test('API00001 - Verify that health is returned when requested', async ({ request }) => {
                const response = await request.get('/health');
                expect(response.status()).toBe(200);
                expect(await response.json()).toEqual({ status: 'ok' });
            });`,
            );
            await writeFile(
                join(dir, 'browser.spec.ts'),
                `import { test, expect } from 'playwright-mixtape-reporter/metrics';
            test('TC0001 - Verify that confirmation is shown when booking', async ({ page }) => {
                await page.goto('/');
                await page.getByRole('button', { name: 'Book now' }).click();
                await expect(page.getByRole('button', { name: 'Booked', exact: true })).toBeVisible();
            });
            test('TC0002 - Verify that a recovered browser attempt keeps its trace', async ({ page }, testInfo) => {
                await page.goto('/');
                await expect(page.getByRole('button', { name: 'Book now' })).toBeVisible();
                expect(testInfo.retry, 'Browser fixture intentionally fails before retry').toBeGreaterThan(0);
            });`,
            );
            const config = join(dir, 'playwright.config.cjs');
            await writeFile(
                config,
                `module.exports = {
            testDir: __dirname,
            outputDir: ${JSON.stringify(join(dir, 'output'))},
            use: { baseURL: ${JSON.stringify(baseURL)}, headless: true, trace: 'retain-on-failure' },
            retries: 1,
            workers: 2,
            projects: [
                { name: 'API', testMatch: 'api.spec.ts' },
                { name: 'Chrome', testMatch: 'browser.spec.ts' },
            ],
        };`,
            );
            const execution = await command(
                ['test', '--config', config, '--reporter', reporter],
                packageDir,
            );
            assert.equal(execution.code, 0, execution.output);
            assert.match(execution.output, /✅ \[API\] › API00001/);
            assert.match(execution.output, /✅ \[Chrome\] › TC0001/);
            assert.match(
                execution.output,
                /passed: 2 .*failed: 0 .*flaky: 1 .*skipped: 0/,
            );
            assert.match(execution.output, /Pass rate: 2\/3 \(66\.7%\)/);
            const { readdir } = await import('node:fs/promises');
            const directory = process.env[metricsEnvironment]!;
            const samples = await Promise.all(
                (await readdir(directory))
                    .filter((file) => file.endsWith('.json'))
                    .map(
                        async (file) =>
                            JSON.parse(
                                await readFile(join(directory, file), 'utf8'),
                            ) as {
                                received: number;
                                sent: number;
                            },
                    ),
            );
            assert.equal(
                samples.length,
                3,
                'API, browser and retry processes publish separate snapshots',
            );
            for (const sample of samples) {
                assert.ok(
                    sample.received > 0,
                    'API and browser response bytes are sampled',
                );
                assert.ok(
                    sample.sent > 0,
                    'API and browser request bytes are sampled',
                );
            }
            await metrics.poll();
            const resources = metrics.current([]);
            assert.equal(resources.cpuAvailable, true);
            assert.ok(resources.cpu >= 0 && resources.cpu <= 100);
            assert.ok(
                resources.received > 0,
                'Combined API and browser traffic is retained after workers finish',
            );
            const log = await readFile(
                join(dir, 'test-results/mixtape-reporter/issues.log'),
                'utf8',
            );
            assert.match(log, /FLAKY 1: TC0002/);
            assert.match(
                log,
                /Browser fixture intentionally fails before retry/,
            );
            assert.match(log, /Attempt 2\/2 \| passed/);
            assert.match(log, /Available traces: 1/);
            const tracePath = log
                .split('\n')
                .find((line) =>
                    /^\s{4}(?:\/|[A-Z]:).*[/]trace\.zip$/.test(
                        line.replaceAll('\\', '/'),
                    ),
                )
                ?.trim();
            assert.ok(tracePath);
            assert.equal(
                (await readFile(tracePath)).subarray(0, 2).toString(),
                'PK',
            );
        } finally {
            metrics.stop();
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
            await rm(dir, { recursive: true, force: true });
        }
    },
);
