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

test('can omit captured streams while retaining errors and trace references', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mixtape-private-log-'));
    try {
        const result = attempt('failed');
        result.errors = [{ message: 'retain diagnostic error' }];
        result.stdout = ['synthetic stdout secret'];
        result.stderr = [Buffer.from('synthetic stderr secret')];
        result.attachments = [
            {
                name: 'trace',
                contentType: 'application/zip',
                path: join(dir, 'trace.zip'),
            },
        ];
        const path = join(dir, 'issues.log');
        writeIssueLog(
            path,
            [item('failure', 'unexpected', [result])],
            finished,
            [],
            { includeOutputInDiagnostics: false },
        );
        const log = readFileSync(path, 'utf8');
        assert.doesNotMatch(log, /synthetic|stdout:|stderr:/);
        assert.match(log, /retain diagnostic error/);
        assert.match(log, /trace.zip/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('redacts complete sanitized lines across every output chunk boundary, including errors and labels', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mixtape-redaction-'));
    const secret = 'synthetic-secret';
    try {
        const bytes = Buffer.from(`Привіт ${secret}\n`);
        const path = join(dir, 'issues.log');
        for (let split = 0; split <= bytes.length; split++) {
            const result = attempt('failed');
            result.errors = [{ message: `error ${secret}` }];
            result.stdout = [bytes.subarray(0, split), bytes.subarray(split)];
            result.stderr = [`partial ${secret}`];
            writeIssueLog(
                path,
                [item(secret, 'unexpected', [result])],
                finished,
                [{ message: secret }],
                {
                    redactDiagnosticText: (line) =>
                        line.replaceAll(
                            secret,
                            '\u001b[31m[REDACTED]\u001b[0m',
                        ),
                },
            );
            const log = readFileSync(path, 'utf8');
            assert.doesNotMatch(log, /synthetic-secret|\uFFFD/);
            assert.equal(log.includes('\u001b'), false);
            assert.match(log, /Привіт \[REDACTED\]/);
            assert.match(log, /partial \[REDACTED\]/);
            assert.match(log, /error \[REDACTED\]/);
            assert.equal(
                result.errors[0]!.message,
                `error ${secret}`,
                'Other reporters retain their original data',
            );
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('redaction fails closed on callback failures and oversized lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mixtape-redaction-errors-'));
    try {
        const path = join(dir, 'issues.log');
        const result = attempt('failed');
        result.stdout = [
            'synthetic-',
            'secret\n',
            'x'.repeat(65536),
            'synthetic-secret\nnext line\n',
        ];
        const tests = [item('failure', 'unexpected', [result])];
        writeIssueLog(path, tests, finished, [], {
            redactDiagnosticText: (line) => {
                if (line.includes('synthetic-secret'))
                    throw new Error('synthetic-secret');
                return line;
            },
        });
        const log = readFileSync(path, 'utf8');
        assert.doesNotMatch(log, /synthetic-secret|x{100}/);
        assert.match(log, /redaction failed; line omitted/);
        assert.match(log, /exceeds redaction buffer limit/);
        assert.match(log, /next line/);
        for (const callback of [
            () => 1,
            async () => {
                throw new Error('synthetic-secret');
            },
        ]) {
            writeIssueLog(path, tests, finished, [], {
                redactDiagnosticText: callback as unknown as (
                    text: string,
                ) => string,
            });
            assert.doesNotMatch(readFileSync(path, 'utf8'), /synthetic-secret/);
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('caps UTF-8 issue-log bytes with a visible notice and no partial characters or temporary files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mixtape-log-limit-'));
    try {
        const path = join(dir, 'issues.log');
        const result = attempt('failed');
        result.stdout = ['🎵'.repeat(10000), 'should never reach the file'];
        for (const maximum of [1024, 1025, 1026, 1027]) {
            const info = writeIssueLog(
                path,
                [item('failure', 'unexpected', [result])],
                finished,
                [],
                { maxDiagnosticBytes: maximum },
            );
            const bytes = readFileSync(path);
            assert.equal(info.truncated, true);
            assert.ok(bytes.length <= maximum);
            const log = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            assert.match(log, /Diagnostics truncated at configured byte limit/);
            assert.doesNotMatch(log, /should never reach|\uFFFD/);
            assert.deepEqual(readdirSync(dir), ['issues.log']);
            if (process.platform !== 'win32')
                assert.equal(statSync(path).mode & 0o777, 0o600);
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('reporter passes diagnostic privacy controls through without modifying captured results', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mixtape-reporter-privacy-'));
    const stdout = mock.method(process.stdout, 'write', () => true);
    try {
        const path = join(dir, 'issues.log');
        const result = attempt('failed');
        result.stdout = ['synthetic captured secret'];
        result.errors = [{ message: 'synthetic error secret' }];
        const selected = item('failure', 'unexpected', [result]);
        const reporter = new MixtapeReporter({
            colorMode: 'bw',
            printFailureDetails: false,
            outputFile: path,
            includeOutputInDiagnostics: false,
            maxDiagnosticBytes: 1024,
            redactDiagnosticText: (line) =>
                line.replaceAll('synthetic error secret', '[REDACTED]'),
        });
        reporter.onBegin(
            { rootDir: dir, workers: 1 } as FullConfig,
            { allTests: () => [selected] } as unknown as Suite,
        );
        reporter.onEnd(finished);
        const log = readFileSync(path, 'utf8');
        assert.doesNotMatch(log, /synthetic/);
        assert.match(log, /\[REDACTED\]/);
        assert.ok(statSync(path).size <= 1024);
        assert.equal(result.stdout[0], 'synthetic captured secret');
        assert.equal(result.errors[0]!.message, 'synthetic error secret');
    } finally {
        stdout.mock.restore();
        rmSync(dir, { recursive: true, force: true });
    }
});
