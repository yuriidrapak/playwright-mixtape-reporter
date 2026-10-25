import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type {
    FullConfig,
    FullResult,
    Suite,
    TestCase,
    TestResult,
} from '@playwright/test/reporter';
import MixtapeReporter, { type MixtapeReporterOptions } from '../src/index.ts';
import { displayWidth } from '../src/layout.ts';

function result(status: TestResult['status'], retry = 0): TestResult {
    return {
        status,
        retry,
        duration: 17_000,
        errors: [],
    } as unknown as TestResult;
}

function testCase(
    title: string,
    results: TestResult[] = [result('passed')],
    outcome: ReturnType<TestCase['outcome']> = 'expected',
    expectedStatus: TestCase['expectedStatus'] = 'passed',
    project = 'Chrome',
): TestCase {
    return {
        title,
        results,
        expectedStatus,
        retries: 1,
        location: {
            file: '/workspace/tests/booking.spec.ts',
            line: 12,
            column: 3,
        },
        parent: { project: () => ({ name: project }) },
        outcome: () => outcome,
        titlePath: () => ['', project, 'booking.spec.ts', 'Booking', title],
    } as unknown as TestCase;
}

function run(
    tests: TestCase[],
    options: MixtapeReporterOptions = { colors: false },
    status: FullResult['status'] = 'passed',
    extra?: (reporter: MixtapeReporter) => void,
): string {
    let output = '';
    const stdout = mock.method(
        process.stdout,
        'write',
        (chunk: string | Uint8Array) => {
            output += chunk.toString();
            return true;
        },
    );
    try {
        const reporter = new MixtapeReporter({
            theme: 'compact',
            outputFile: false,
            ...options,
        });
        assert.equal(reporter.printsToStdio(), true);
        reporter.onBegin(
            {
                workers: 4,
                rootDir: '/workspace',
                shard: { current: 2, total: 3 },
            } as FullConfig,
            { allTests: () => tests } as Suite,
        );
        for (const item of tests) {
            for (const attempt of item.results)
                reporter.onTestEnd(item, attempt);
        }
        extra?.(reporter);
        assert.equal(
            reporter.onEnd({
                status,
                duration: 242_000,
                startTime: new Date(),
            }),
            undefined,
        );
        return output;
    } finally {
        stdout.mock.restore();
    }
}

test('matches the compact layout and counts test cases once across retries and projects', () => {
    const tests = [
        testCase('TC0101 - Verify booking'),
        testCase(
            'API00001 - Verify quote',
            [result('passed')],
            'expected',
            'passed',
            'API',
        ),
        testCase(
            'TC0102 - Verify validation',
            [result('failed'), result('failed', 1)],
            'unexpected',
        ),
        testCase(
            'TC0103 - Verify availability',
            [result('failed'), result('passed', 1)],
            'flaky',
        ),
        testCase('TC0104 - Verify export', [result('skipped')], 'skipped'),
    ];
    const output = run(tests, { printFailureDetails: false }, 'failed');
    assert.match(
        output,
        /📋 Playwright Mixtape Reporter\n🧪 Running 5 tests on 4 workers · shard 2\/3\n─{80}\nRun:/,
    );
    assert.match(output, /✅ \[Chrome\] › TC0101 - Verify booking \(17s\)/);
    assert.doesNotMatch(output, /attempt 1\//);
    assert.match(output, /✅ \[API\] › API00001 - Verify quote \(17s\)/);
    assert.match(output, /❌ \[Chrome\] › TC0102 - Verify validation \(17s\)/);
    assert.match(
        output,
        /❌ \[Chrome\] › TC0102 - Verify validation \(17s\) · attempt 2\/2/,
    );
    assert.match(
        output,
        /🟡 \[Chrome\] › TC0103 - Verify availability \(17s\) · attempt 2\/2/,
    );
    assert.match(
        output,
        /✅ passed: 2 \| ❌ failed: 1 \| 🟡 flaky: 1 \| ⏩ skipped: 1/,
    );
    assert.match(
        output,
        /📊 Pass rate: 2\/5 \(40\.0%\) \| Duration: 4m 2s\nRun status: failed/,
    );
    assert.doesNotMatch(output, /Failures:/);
    assert.equal(output.includes('\u001b'), false);
});

test('respects expected failures, diagnoses unexpected passes and timeouts, and omits recovered errors', () => {
    const failure = result('failed');
    failure.errors = [{ message: 'First attempt error that recovered' }];
    const timeout = result('timedOut', 1);
    timeout.errors = [
        { stack: 'Error: deadline exceeded\n    at booking.spec.ts:12:3' },
    ];
    const output = run(
        [
            testCase('known defect', [result('failed')], 'expected', 'failed'),
            testCase(
                'unexpected fix',
                [result('passed')],
                'unexpected',
                'failed',
            ),
            testCase('slow booking', [timeout], 'unexpected'),
            testCase('recovered', [failure, result('passed', 1)], 'flaky'),
        ],
        {},
        'failed',
    );
    assert.match(
        output,
        /✅ \[Chrome\] › known defect \(17s\) · expected failure/,
    );
    assert.match(
        output,
        /❌ \[Chrome\] › unexpected fix \(17s\) · unexpected pass/,
    );
    assert.match(output, /slow booking \(17s\) · timed out · attempt 2\/2/);
    assert.match(
        output,
        /Failures:\n\n {2}1\) \[Chrome\] › unexpected fix\n {5}tests[/\\]booking.spec.ts:12:3\n {5}Expected failed, received passed\./,
    );
    assert.match(output, /Error: deadline exceeded/);
    assert.doesNotMatch(output, /First attempt error that recovered/);
    assert.match(output, /passed: 1 .*failed: 2 .*flaky: 1 .*skipped: 0/);
});

test('keeps interrupted and never-started tests out of passed and failed counts', () => {
    const output = run(
        [
            testCase('interrupted', [result('interrupted')], 'unexpected'),
            testCase('not started', [], 'skipped'),
        ],
        {},
        'interrupted',
    );
    assert.match(output, /⏹️ \[Chrome\] › interrupted/);
    assert.match(output, /passed: 0 .*failed: 0 .*interrupted: 1 .*not run: 1/);
    assert.match(output, /Pass rate: 0\/2 \(0\.0%\)/);
    assert.match(output, /Run status: interrupted/);
});

test('reports global errors even without discovered tests and never overrides runner status', () => {
    const output = run([], {}, 'failed', (reporter) => {
        reporter.onError({ message: 'Global setup failed' });
    });
    assert.match(output, /Global error:\n {5}Global setup failed/);
    assert.match(output, /Pass rate: 0\/0 \(0\.0%\)/);
    assert.match(output, /Run status: failed\nGlobal errors: 1/);
});

test('supports suite titles, color opt-in and ASCII status markers without losing test identifiers', () => {
    const output = run([testCase('TC0101 - Verify booking')], {
        colors: true,
        symbols: 'ascii',
        includeSuiteTitles: true,
        title: 'Example API',
    });
    assert.match(output, /Example API\nRunning 1 test on 4 workers/);
    assert.ok(output.includes('\u001b[96m(17s)\u001b[0m'));
    assert.doesNotMatch(output, /attempt 1\//);
    assert.ok(
        output.includes(
            '\u001b[32m[PASS]\u001b[0m    \u001b[32m[Chrome] › Booking › TC0101',
        ),
    );
    assert.doesNotMatch(output, /📋|🧪|✅|─/);
});

test('sanitizes terminal controls and multiline names to preserve one line per attempt', () => {
    const output = run(
        [
            testCase(
                'TC0101\n\u001b[31m - Verify\rbooking\u0000',
                [result('passed')],
                'expected',
                'passed',
                'API\nproject',
            ),
        ],
        { title: 'Compact\nReporter' },
    );
    assert.match(output, /📋 Compact Reporter\n/);
    assert.match(
        output,
        /✅ \[API project\] › TC0101 {2}- Verify booking \(17s\)\n/,
    );
    for (const control of ['\u001b', '\u0000', '\r'])
        assert.equal(output.includes(control), false);
});

test('suppresses worker logs by default and keeps forwarded partial lines separate from results', () => {
    const quiet = run([], {}, 'passed', (reporter) => {
        reporter.onStdOut('worker stdout');
        reporter.onStdErr(Buffer.from('worker stderr'));
    });
    assert.doesNotMatch(quiet, /worker stdout|worker stderr/);
    let stderr = '';
    const err = mock.method(
        process.stderr,
        'write',
        (chunk: string | Uint8Array) => {
            stderr += chunk.toString();
            return true;
        },
    );
    try {
        const output = run([], { printOutput: true }, 'passed', (reporter) => {
            reporter.onStdErr(Buffer.from('worker stderr\n'));
            reporter.onStdOut('worker stdout');
            reporter.onTestEnd(testCase('next result'), result('passed'));
        });
        assert.equal(stderr, 'worker stderr\n');
        assert.match(output, /worker stdout\n {2}✅ \[Chrome\] › next result/);
    } finally {
        err.mock.restore();
    }
});

test('auto-detects colors from environment and renders subsecond durations and anonymous projects', () => {
    const originalNoColor = process.env.NO_COLOR;
    const originalForceColor = process.env.FORCE_COLOR;
    try {
        process.env.NO_COLOR = '1';
        process.env.FORCE_COLOR = '1';
        const short = result('passed');
        short.duration = 42;
        const output = run(
            [testCase('fast API test', [short], 'expected', 'passed', '')],
            {},
        );
        assert.match(output, / {2}✅ fast API test \(42ms\)/);
        assert.equal(output.includes('\u001b'), false);
        delete process.env.NO_COLOR;
        assert.ok(run([], {}).includes('\u001b[32m'));
        process.env.FORCE_COLOR = '0';
        assert.equal(run([], {}).includes('\u001b'), false);
    } finally {
        if (originalNoColor === undefined) delete process.env.NO_COLOR;
        else process.env.NO_COLOR = originalNoColor;
        if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
        else process.env.FORCE_COLOR = originalForceColor;
    }
});

test('wraps long failure titles, source locations and stack traces with hanging indentation', () => {
    const before = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    try {
        Object.defineProperty(process.stdout, 'columns', {
            value: 80,
            configurable: true,
        });
        const failed = result('failed');
        failed.errors = [
            {
                stack: 'Error: delete isolated catalog fixture\n\nExpected: 204\nReceived: 502\n    at Object.base.extend.ownedCatalog.timeout (/Users/example/git/example-automation-suite/api-tests/src/fixtures/ownedCatalogTest.ts:83:23)',
            },
        ];
        const title =
            'API00980 - Verify that a catalog PATCH that supplies only embedOptions returns 200 and a fresh GET preserves every product selection when the catalog is the default catalog';
        const output = run(
            [testCase(title, [failed], 'unexpected')],
            { colors: false },
            'failed',
        );
        const details = output.slice(
            output.indexOf('Failures:\n') + 'Failures:\n'.length,
            output.indexOf('\n' + '─'.repeat(80) + '\nSummary:'),
        );
        const lines = details
            .trimEnd()
            .split('\n')
            .filter((line) => line.trim());
        assert.ok(lines[0]?.startsWith('  1) '));
        for (const line of lines) assert.ok(displayWidth(line) <= 79, line);
        for (const line of lines.slice(1))
            assert.ok(line.startsWith('     '), line);
        assert.ok(lines.filter((line) => line.includes('catalog')).length > 1);
    } finally {
        if (before) Object.defineProperty(process.stdout, 'columns', before);
        else Reflect.deleteProperty(process.stdout, 'columns');
    }
});
