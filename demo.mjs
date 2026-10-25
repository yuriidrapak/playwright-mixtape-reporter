import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import MixtapeReporter from './dist/index.js';

const { values } = parseArgs({
    options: { workers: { type: 'string', default: '6' } },
});
const workers = Number(values.workers);
if (!Number.isInteger(workers) || workers < 1 || workers > 64)
    throw new Error('--workers must be an integer between 1 and 64');
const started = performance.now();
const source = fileURLToPath(import.meta.url);
const tests = Array.from({ length: workers * 3 }, (_, index) => {
    const project = index % 2 ? 'API' : 'Chrome';
    const title = `DEMO${(index + 1).toString().padStart(4, '0')} - ${['Search available experiences', 'Confirm the guest booking', 'Validate the transfer quote'][index % 3]}`;
    return {
        title,
        retries: 1,
        expectedStatus: 'passed',
        results: [],
        parent: { project: () => ({ name: project }) },
        location: { file: source, line: 1, column: 1 },
        titlePath: () => ['', project, 'demo.mjs', title],
        outcome() {
            const last = this.results.at(-1);
            if (!last || last.status === 'skipped') return 'skipped';
            if (last.status !== 'passed') return 'unexpected';
            return last.retry ? 'flaky' : 'expected';
        },
    };
});
const reporter = new MixtapeReporter({
    title: 'DEMO / simulated test events',
    animations: true,
    outputFile: false,
});
reporter.onBegin(
    { workers, rootDir: process.cwd() },
    { allTests: () => tests },
);
process.once('SIGINT', () => {
    reporter.onEnd({
        status: 'interrupted',
        duration: performance.now() - started,
        startTime: new Date(),
    });
    void reporter.onExit().then(() => process.exit(130));
});

await Promise.all(
    Array.from({ length: workers }, async (_, slot) => {
        let processIndex = slot;
        for (let job = 0; job < 3; job++) {
            const current = tests[slot * 3 + job];
            const skipped = slot === workers - 1 && job === 2;
            const retries = slot === 0 && job === 0 ? 1 : 0;
            for (let retry = 0; retry <= retries; retry++) {
                if (retry) processIndex = slot + workers;
                const result = {
                    parallelIndex: slot,
                    workerIndex: skipped ? -1 : processIndex,
                    retry,
                    status: 'passed',
                    errors: [],
                    duration: 0,
                    startTime: new Date(),
                };
                if (skipped) {
                    result.status = 'skipped';
                } else {
                    const attemptStart = performance.now();
                    reporter.onTestBegin(current, result);
                    await delay(850 + ((slot * 170 + job * 220) % 900));
                    result.duration = performance.now() - attemptStart;
                    if (retries && retry === 0) {
                        result.status = 'failed';
                        result.errors.push({
                            message: 'Intentional demo retry',
                        });
                    }
                }
                current.results.push(result);
                reporter.onTestEnd(current, result);
            }
        }
    }),
);
reporter.onEnd({
    status: 'passed',
    duration: performance.now() - started,
    startTime: new Date(),
});
await reporter.onExit();
