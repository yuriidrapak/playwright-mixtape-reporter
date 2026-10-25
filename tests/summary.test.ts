import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { resolveOptions } from '../src/options.ts';
import { Terminal } from '../src/terminal.ts';
import { renderSummary, type Summary } from '../src/summary.ts';
import { displayWidth } from '../src/layout.ts';
import { palette } from '../src/colors.ts';

const data: Summary = {
    counts: {
        passed: 952,
        failed: 1,
        flaky: 4,
        skipped: 13,
        interrupted: 0,
        notRun: 0,
    },
    total: 970,
    runtime: '29m 13s',
    status: 'failed',
    globalErrors: 0,
    log: {
        path: resolve(
            '/tmp/project with spaces/test-results/mixtape-reporter/issues.log',
        ),
        traces: 5,
        failed: 1,
        flaky: 4,
    },
};

test('renders a responsive final mix with semantic counts, runtime and complete diagnostics paths in color and BW', () => {
    for (const colorMode of ['color', 'bw'] as const) {
        const options = resolveOptions({ colorMode });
        const terminal = new Terminal(options);
        for (const columns of [32, 48, 80, 120]) {
            const output = renderSummary(data, options, terminal, columns);
            for (const line of output.trimEnd().split('\n'))
                assert.ok(displayWidth(line) < columns, `${columns}: ${line}`);
            const plain = stripVTControlCharacters(output);
            assert.match(plain, /FINAL MIX/);
            assert.match(plain, /RUN FAILED/);
            assert.ok(plain.replaceAll(/\s+/g, ' ').includes('29m 13s'));
            assert.ok(plain.includes('98.1%'));
            assert.match(plain, /DIAGNOSTICS/);
            assert.ok(plain.includes('issues.log'));
        }
        const output = renderSummary(data, options, terminal, 120);
        if (colorMode === 'color') {
            for (const [tone, text] of [
                ['green', 'passed: 952'],
                ['red', 'failed: 1'],
                ['yellow', 'flaky: 4'],
            ] as const)
                assert.ok(output.includes(`\u001b[${palette[tone]}m${text}`));
        } else {
            assert.equal(output.includes('\u001b'), false);
            assert.ok(
                output
                    .split('')
                    .every(
                        (char) =>
                            char === '\n' ||
                            (char.charCodeAt(0) >= 32 &&
                                char.charCodeAt(0) <= 126),
                    ),
            );
        }
    }
});

test('links local log files only on a color-capable TTY and handles empty/interrupted runs', () => {
    const original = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    const originalTerm = process.env.TERM;
    process.env.TERM = 'xterm-256color';
    try {
        Object.defineProperty(process.stdout, 'isTTY', {
            value: true,
            configurable: true,
        });
        const options = resolveOptions({ colorMode: 'color' });
        const terminal = new Terminal(options);
        const linked = renderSummary(data, options, terminal, 100);
        assert.ok(data.log);
        assert.ok(
            linked.includes(
                `\u001b]8;;${pathToFileURL(data.log.path).href}\u001b\\`,
            ),
        );
        assert.ok(stripVTControlCharacters(linked).includes('issues.log'));
        Object.defineProperty(process.stdout, 'isTTY', {
            value: false,
            configurable: true,
        });
        assert.equal(
            renderSummary(data, options, terminal, 100).includes('\u001b]8;'),
            false,
        );
        const output = renderSummary(
            {
                ...data,
                counts: {
                    ...data.counts,
                    passed: 0,
                    failed: 0,
                    flaky: 0,
                    skipped: 0,
                    interrupted: 1,
                    notRun: 1,
                },
                total: 0,
                status: 'interrupted',
            },
            options,
            terminal,
            100,
        );
        assert.match(stripVTControlCharacters(output), /0\/0 \(0.0%\)/);
        assert.doesNotMatch(output, /NaN|Infinity/);
    } finally {
        if (original) Object.defineProperty(process.stdout, 'isTTY', original);
        else Reflect.deleteProperty(process.stdout, 'isTTY');
        if (originalTerm === undefined) delete process.env.TERM;
        else process.env.TERM = originalTerm;
    }
});

test('keeps every frame edge aligned with fixed-cell badges and an intact log filename', () => {
    const options = resolveOptions({ colorMode: 'color' });
    const terminal = new Terminal(options);
    const example: Summary = {
        ...data,
        counts: {
            ...data.counts,
            passed: 981,
            failed: 1,
            flaky: 0,
            skipped: 17,
        },
        total: 999,
        runtime: '14m 49s',
        log: {
            path: '/fixtures/projects/example-company/enterprise-automation/testing/api-tests/artifacts/test-results/mixtape-reporter/issues.log',
            failed: 1,
            flaky: 0,
            traces: 0,
        },
    };
    for (const columns of [32, 80, 96, 136]) {
        const output = stripVTControlCharacters(
            renderSummary(example, options, terminal, columns),
        );
        const lines = output.split('\n').filter(Boolean);
        const width = displayWidth(lines[0]!);
        for (const line of lines) assert.equal(displayWidth(line), width, line);
        assert.match(output, /\[PASS\].*passed: 981/);
        assert.doesNotMatch(output, /✅|❌|🟡|⏩/);
        assert.doesNotMatch(output, /│ ues\.log/); // No continuation containing only the filename tail.
        assert.equal(
            lines.filter((line) => line.includes('issues.log')).length,
            2,
        );
        const path = lines.find(
            (line) => line.includes('issues.log') && !line.includes('Open'),
        )!;
        assert.ok(path.includes('…'));
    }
});

test('makes diagnostic truncation visible in both summary themes', () => {
    for (const theme of ['cassette', 'compact'] as const) {
        const options = resolveOptions({ theme, colorMode: 'bw' });
        const terminal = new Terminal(options);
        const output = renderSummary(
            { ...data, log: { ...data.log!, truncated: true } },
            options,
            terminal,
            120,
        );
        assert.match(output, /Issue log truncated at configured byte limit/);
        assert.match(output, /issues.log/);
    }
});
