import assert from 'node:assert/strict';
import {
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, mock } from 'node:test';
import type {
    FullConfig,
    FullResult,
    Suite,
    TestCase,
    TestResult,
} from '@playwright/test/reporter';
import { writeIssueLog } from '../src/diagnostics.ts';
import MixtapeReporter from '../src/index.ts';

const finished = {
    status: 'failed',
    duration: 1753000,
    startTime: new Date('2026-10-23T12:00:00Z'),
} as FullResult;
function attempt(status: TestResult['status'], retry = 0): TestResult {
    return {
        status,
        retry,
        duration: 5000,
        errors: [],
        stdout: [],
        stderr: [],
        attachments: [],
    } as unknown as TestResult;
}
function item(
    title: string,
    outcome: ReturnType<TestCase['outcome']>,
    results: TestResult[],
    expectedStatus = 'passed',
): TestCase {
    return {
        title,
        expectedStatus,
        retries: 1,
        results,
        location: { file: '/tests/api.spec.ts', line: 10, column: 4 },
        parent: { project: () => ({ name: 'API' }) },
        titlePath: () => ['', 'API', 'api.spec.ts', 'Booking', title],
        outcome: () => outcome,
    } as unknown as TestCase;
}

test('persists every failed/flaky attempt, output, trace commands and in-memory traces without successful test noise', () => {
    const dir = mkdtempSync(join(tmpdir(), 'compact-issues-'));
    try {
        const trace = join(dir, "trace with ' quotes.zip");
        writeFileSync(trace, 'fixture trace');
        const first = attempt('failed');
        first.errors = [
            {
                stack: '\u001b[31mError: recovered first attempt\u001b[0m\n  at fixture.ts:10',
            },
        ];
        first.stdout = ['captured console log\n'];
        first.stderr = [Buffer.from('captured stderr\n')];
        first.attachments = [
            { name: 'trace', contentType: 'application/zip', path: trace },
        ];
        const recovered = attempt('passed', 1);
        recovered.attachments = [
            {
                name: 'trace',
                contentType: 'application/zip',
                body: Buffer.from('inline trace'),
            },
        ];
        const failure = attempt('timedOut', 1);
        failure.errors = [{ message: 'Final deadline exceeded' }];
        failure.attachments = [
            {
                name: 'trace',
                contentType: 'application/zip',
                path: join(dir, 'missing-trace.zip'),
            },
        ];
        const path = join(dir, 'reports', 'issues.log');
        const info = writeIssueLog(
            path,
            [
                item('API00001 - failing case', 'unexpected', [
                    attempt('failed'),
                    failure,
                ]),
                item('API00002 - recovered case', 'flaky', [first, recovered]),
                item('ordinary success', 'expected', [attempt('passed')]),
                item(
                    'expected failure',
                    'expected',
                    [attempt('failed')],
                    'failed',
                ),
            ],
            finished,
            [{ message: 'Global teardown error' }],
        );
        const log = readFileSync(path, 'utf8');
        assert.equal(info.failed, 1);
        assert.equal(info.flaky, 1);
        assert.equal(info.traces, 2);
        assert.match(log, /FLAKY 2: API00002/);
        assert.match(log, /Attempt 1\/2 \| failed/);
        assert.match(log, /Attempt 2\/2 \| passed/);
        assert.match(log, /Error: recovered first attempt/);
        assert.match(log, /Final deadline exceeded/);
        assert.match(log, /captured console log/);
        assert.match(log, /captured stderr/);
        assert.match(log, /file:\/\//);
        assert.match(log, /npx playwright show-trace/);
        assert.match(log, /file unavailable/);
        assert.match(log, /Trace: not recorded for this attempt/);
        assert.match(log, /Global teardown error/);
        assert.doesNotMatch(log, /ordinary success|expected failure/);
        assert.equal(log.includes('\u001b'), false);
        if (process.platform !== 'win32') {
            assert.equal(statSync(path).mode & 0o777, 0o600);
            assert.equal(
                statSync(
                    join(dir, 'reports/issues-traces/test-2-attempt-2-1.zip'),
                ).mode & 0o777,
                0o600,
            );
        }
        assert.equal(
            readFileSync(
                join(dir, 'reports/issues-traces/test-2-attempt-2-1.zip'),
                'utf8',
            ),
            'inline trace',
        );
        writeIssueLog(path, [], { ...finished, status: 'passed' }, []);
        assert.match(readFileSync(path, 'utf8'), /No failed or flaky tests/);
        assert.doesNotMatch(
            readFileSync(path, 'utf8'),
            /recovered first attempt/,
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('keeps the previous log on failure and replaces a log symlink without following it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mixtape-atomic-'));
    try {
        const path = join(dir, 'issues.log');
        writeFileSync(path, 'previous complete report');
        assert.throws(() =>
            writeIssueLog(
                path,
                [],
                { ...finished, startTime: new Date(NaN) },
                [],
            ),
        );
        assert.equal(readFileSync(path, 'utf8'), 'previous complete report');
        assert.deepEqual(readdirSync(dir), ['issues.log']);
        if (process.platform !== 'win32') {
            const target = join(dir, 'unrelated.txt');
            writeFileSync(target, 'keep me');
            rmSync(path);
            symlinkSync(target, path);
            writeIssueLog(path, [], finished, []);
            assert.equal(readFileSync(target, 'utf8'), 'keep me');
            assert.match(
                readFileSync(path, 'utf8'),
                /No failed or flaky tests/,
            );
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('resolves log paths beside the config, isolates shards, supports opt-out and reports write errors without changing run status', () => {
    const dir = mkdtempSync(join(tmpdir(), 'compact-paths-'));
    let output = '';
    const stdout = mock.method(
        process.stdout,
        'write',
        (chunk: string | Uint8Array) => {
            output += chunk.toString();
            return true;
        },
    );
    const config = {
        rootDir: dir,
        configFile: join(dir, 'playwright.config.ts'),
        workers: 1,
        shard: { current: 2, total: 3 },
    } as FullConfig;
    try {
        const reporter = new MixtapeReporter({
            colorMode: 'bw',
            outputFile: 'logs/issues.log',
            printFailureDetails: false,
        });
        reporter.onBegin(config, { allTests: () => [] } as unknown as Suite);
        assert.equal(reporter.onEnd(finished), undefined);
        const log = join(dir, 'logs/issues-shard-2-of-3.log');
        assert.match(readFileSync(log, 'utf8'), /Run status: failed/);
        assert.ok(output.includes('issues-shard-2-of-3.log'));
        assert.equal(output.includes('\u001b'), false);
        output = '';
        const disabled = new MixtapeReporter({
            colors: false,
            outputFile: false,
        });
        disabled.onBegin(config, { allTests: () => [] } as unknown as Suite);
        disabled.onEnd(finished);
        assert.doesNotMatch(output, /DIAGNOSTICS/);
        const blocked = join(dir, 'file-instead-of-directory');
        writeFileSync(blocked, 'fixture');
        output = '';
        const broken = new MixtapeReporter({
            colors: false,
            outputFile: join(blocked, 'issues.log'),
        });
        broken.onBegin(config, { allTests: () => [] } as unknown as Suite);
        assert.equal(broken.onEnd(finished), undefined);
        assert.match(output, /Issue log unavailable/);
        assert.match(output, /RUN FAILED/);
    } finally {
        stdout.mock.restore();
        rmSync(dir, { recursive: true, force: true });
    }
});
