import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'playwright-mixtape-reporter/metrics';

const barrier = process.env.MIXTAPE_REPORTER_TEST_BARRIER;
if (!barrier) throw new Error('MIXTAPE_REPORTER_TEST_BARRIER is required');
const workers = Number(process.env.MIXTAPE_REPORTER_TEST_WORKERS);
if (!Number.isInteger(workers) || workers < 1)
    throw new Error('A positive test worker count is required');

for (let index = 0; index < workers; index++) {
    // oxlint-disable-next-line no-empty-pattern -- Playwright requires fixture destructuring.
    test(`Reporter runner ${index + 1}`, async ({}, testInfo) => {
        await writeFile(
            join(barrier, `${testInfo.parallelIndex}.ready`),
            'ready',
        );
        await expect
            .poll(async () => (await readdir(barrier)).length, {
                timeout: 15_000,
            })
            .toBe(workers);
        // Keep every lane executing for several display frames after the barrier.
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(testInfo.parallelIndex).toBeLessThan(workers);
    });
}
