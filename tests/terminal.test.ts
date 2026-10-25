import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { resolveOptions, type MixtapeReporterOptions } from '../src/options.ts';
import { Terminal } from '../src/terminal.ts';
import { displayWidth } from '../src/layout.ts';
import { palette } from '../src/colors.ts';

function environment(values: Record<string, string | undefined>): () => void {
    const before = new Map(
        Object.keys(values).map((key) => [key, process.env[key]]),
    );
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    return () => {
        for (const [key, value] of before) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    };
}

function terminalSize(isTTY: boolean, columns = 80): () => void {
    const beforeTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    const beforeColumns = Object.getOwnPropertyDescriptor(
        process.stdout,
        'columns',
    );
    Object.defineProperty(process.stdout, 'isTTY', {
        value: isTTY,
        configurable: true,
    });
    Object.defineProperty(process.stdout, 'columns', {
        value: columns,
        configurable: true,
    });
    return () => {
        if (beforeTTY)
            Object.defineProperty(process.stdout, 'isTTY', beforeTTY);
        else Reflect.deleteProperty(process.stdout, 'isTTY');
        if (beforeColumns)
            Object.defineProperty(process.stdout, 'columns', beforeColumns);
        else Reflect.deleteProperty(process.stdout, 'columns');
    };
}

test('aligns every status marker and wraps test text in color and BW layouts', () => {
    const restoreTTY = terminalSize(false, 48);
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
        for (const colorMode of ['color', 'bw'] as const) {
            const terminal = new Terminal(
                resolveOptions({ theme: 'cassette', colorMode }),
            );
            const expectedColumn = colorMode === 'bw' ? 12 : 5;
            for (const status of [
                'passed',
                'failed',
                'flaky',
                'skipped',
                'interrupted',
                'notRun',
            ] as const) {
                output = '';
                terminal.writeTest(
                    status,
                    'API00004 - Verify that selected extras keep their final price before checkout',
                    { duration: '17s' },
                );
                const lines = stripVTControlCharacters(output)
                    .trimEnd()
                    .split('\n');
                const first = lines[0] ?? '';
                if (colorMode === 'color') {
                    assert.ok(
                        output.includes(
                            `\u001b[${palette.cyan}m(17s)\u001b[0m`,
                        ),
                    );
                    const tone = {
                        passed: 'green',
                        failed: 'red',
                        flaky: 'yellow',
                    } as const;
                    if (status in tone) {
                        const code = palette[tone[status as keyof typeof tone]];
                        assert.ok(
                            output.includes(`\u001b[${code}mAPI00004`),
                            output,
                        );
                    }
                }
                if (colorMode === 'color') {
                    assert.match(
                        first,
                        /^(?: {2})(?:✅|❌|🟡|⏩|⏹️|➖) API00004/,
                    );
                    if (status === 'skipped') {
                        assert.ok(first.startsWith('  ⏩ API00004'));
                        assert.match(terminal.mark('skipped'), /⏩/);
                        assert.ok(/\p{Emoji_Presentation}/u.test('⏩'));
                    }
                }
                assert.equal(
                    displayWidth(first.slice(0, first.indexOf('API00004'))),
                    expectedColumn,
                );
                assert.ok(lines.length > 1);
                for (const line of lines.slice(1))
                    assert.ok(line.startsWith(' '.repeat(expectedColumn)));
                for (const line of lines)
                    assert.ok(displayWidth(line) <= 48, line);
            }
        }
    } finally {
        stdout.mock.restore();
        restoreTTY();
    }
});

test('animates actual runners without overwriting results or partial test logs, then disposes the timer', (context) => {
    const restoreEnv = environment({ CI: undefined, TERM: 'xterm-256color' });
    const restoreTTY = terminalSize(true);
    context.mock.timers.enable({ apis: ['setInterval'] });
    let output = '';
    const stdout = mock.method(
        process.stdout,
        'write',
        (chunk: string | Uint8Array) => {
            output += chunk.toString();
            return true;
        },
    );
    const terminal = new Terminal(
        resolveOptions({ colorMode: 'color', showLogs: true }),
    );
    try {
        terminal.header(2, 2);
        terminal.start();
        const first = output;
        const active = {
            title: 'API00001 - Verify quote',
            expectedStatus: 'passed' as const,
            retries: 0,
        };
        const result = {
            parallelIndex: 0,
            workerIndex: 0,
            retry: 0,
            status: 'passed' as const,
            duration: 1_000,
        };
        terminal.beginTest(active, result);
        context.mock.timers.tick(120);
        assert.notEqual(output, first);
        assert.ok(
            output.includes('\u001b[3G'),
            'Patch the running count in place',
        );
        assert.match(stripVTControlCharacters(output), /⟦.-.⟧.*API00001/);
        assert.match(stripVTControlCharacters(output), /⟦○-○⟧.*awaiting test/);

        terminal.forward('partial console log', process.stdout);
        const partial = output;
        context.mock.timers.tick(480);
        assert.equal(
            output,
            partial,
            'Animation must pause while a log line is incomplete',
        );
        terminal.endTest(active, result, 'passed');
        terminal.write('  [PASS] API00001\n');
        assert.ok(
            stripVTControlCharacters(output).includes(
                'partial console log\n  [PASS] API00001\n',
            ),
        );
        context.mock.timers.tick(120);
        assert.match(stripVTControlCharacters(output), /0\/2 RUN/);
        assert.match(stripVTControlCharacters(output), /1\/2 DONE 50\.0%/);

        terminal.stop();
        terminal.write('Summary: passed\n');
        const stopped = output;
        context.mock.timers.tick(2_000);
        assert.equal(output, stopped, 'Timer must stop before final output');
        assert.ok(
            stripVTControlCharacters(output).endsWith('Summary: passed\n'),
        );
        assert.ok(output.includes('\u001b[?25h'), 'Restore the cursor on stop');
    } finally {
        terminal.stop();
        stdout.mock.restore();
        restoreTTY();
        restoreEnv();
    }
});

test('inserts wrapped results above the retained panel and patches only live cells', (context) => {
    const restoreEnv = environment({ CI: undefined, TERM: 'xterm-256color' });
    const restoreTTY = terminalSize(true, 80);
    context.mock.timers.enable({ apis: ['setInterval'] });
    let output = '';
    const stdout = mock.method(
        process.stdout,
        'write',
        (chunk: string | Uint8Array) => {
            output += chunk.toString();
            return true;
        },
    );
    const terminal = new Terminal(
        resolveOptions({ colorMode: 'color', showLogs: true }),
    );
    const first = {
        title: 'COMPLETED - Keep the selected extras and final price when the booking changes before checkout',
        expectedStatus: 'passed' as const,
        retries: 0,
    };
    const second = {
        ...first,
        title: 'STABLE - Another worker is still running',
    };
    const result = {
        parallelIndex: 0,
        workerIndex: 0,
        retry: 0,
        status: 'passed' as const,
        duration: 1000,
    };
    const assertRetained = (): void => {
        assert.equal(
            output.includes('\u001b[0J'),
            false,
            'Do not clear the panel',
        );
        assert.equal(
            output.includes('\u001b[2K'),
            false,
            'Do not erase whole rows',
        );
    };
    try {
        terminal.header(2, 2);
        terminal.start();
        terminal.beginTest(first, result);
        terminal.beginTest(second, {
            ...result,
            parallelIndex: 1,
            workerIndex: 1,
        });
        context.mock.timers.tick(120);
        output = '';
        context.mock.timers.tick(120);
        assert.doesNotMatch(output, /STABLE|COMPLETED/);
        assertRetained();
        assert.ok(output.includes('\u001b[?2026h'));
        assert.ok(output.endsWith('\u001b[?2026l'));

        output = '';
        terminal.endTest(first, result, 'passed');
        terminal.writeTest('passed', first.title, { duration: '1s' });
        assert.ok(
            output.includes('\u001b[2L'),
            'Move existing panel cells down for the two-line result',
        );
        assert.doesNotMatch(output, /STABLE/);
        assertRetained();
        assert.equal(output.match(/COMPLETED/g)?.length, 1);
        assert.match(stripVTControlCharacters(output), /awaiting test/);

        output = '';
        context.mock.timers.tick(120);
        assert.doesNotMatch(output, /STABLE|COMPLETED|awaiting test/);
        assertRetained();
        terminal.forward('complete console line\n', process.stdout);
        assert.ok(output.includes('\u001b[1L'));
        assertRetained();

        output = '';
        terminal.write(
            Array.from({ length: 30 }, (_, i) => `Diagnostic ${i}\n`).join(''),
        );
        assert.equal((output.match(/Diagnostic /g) ?? []).length, 30);
        assert.doesNotMatch(output, /STABLE/);
        assertRetained();
    } finally {
        terminal.stop();
        stdout.mock.restore();
        restoreTTY();
        restoreEnv();
    }
});

test('never starts an animation in BW, CI, dumb terminals, redirected output, or when disabled', (context) => {
    context.mock.timers.enable({ apis: ['setInterval'] });
    const cases: Array<{
        options: MixtapeReporterOptions;
        tty?: boolean;
        env?: Record<string, string>;
    }> = [
        { options: { colorMode: 'bw' } },
        { options: { colorMode: 'color' }, tty: false },
        { options: { colorMode: 'color' }, env: { CI: '1' } },
        { options: { colorMode: 'color' }, env: { TERM: 'dumb' } },
        { options: { colorMode: 'color', animations: false } },
        { options: { colorMode: 'color', theme: 'compact' } },
        { options: { colorMode: 'auto' }, env: { NO_COLOR: '1' } },
    ];
    for (const scenario of cases) {
        const restoreEnv = environment({
            CI: undefined,
            TERM: 'xterm',
            NO_COLOR: undefined,
            FORCE_COLOR: undefined,
            ...scenario.env,
        });
        const restoreTTY = terminalSize(scenario.tty ?? true);
        let output = '';
        const stdout = mock.method(
            process.stdout,
            'write',
            (chunk: string | Uint8Array) => {
                output += chunk.toString();
                return true;
            },
        );
        const terminal = new Terminal(
            resolveOptions({ animations: true, ...scenario.options }),
        );
        try {
            terminal.header(2, 2);
            const header = output;
            terminal.start();
            context.mock.timers.tick(1_000);
            assert.equal(output, header);
        } finally {
            terminal.stop();
            stdout.mock.restore();
            restoreTTY();
            restoreEnv();
        }
    }
});

test('BW produces ASCII decorations and strips ANSI from forwarded stdout and stderr', () => {
    let output = '';
    let errors = '';
    const stdout = mock.method(
        process.stdout,
        'write',
        (chunk: string | Uint8Array) => {
            output += chunk.toString();
            return true;
        },
    );
    const stderr = mock.method(
        process.stderr,
        'write',
        (chunk: string | Uint8Array) => {
            errors += chunk.toString();
            return true;
        },
    );
    const terminal = new Terminal(
        resolveOptions({
            colorMode: 'bw',
            colors: true,
            symbols: 'emoji',
            showLogs: true,
        }),
    );
    try {
        terminal.header(2, 2);
        terminal.write(
            `${terminal.mark('passed')} [API]${terminal.arrow}API00001\n`,
        );
        terminal.forward('\u001b[31mconsole.log\u001b[0m\n', process.stdout);
        terminal.forward(
            Buffer.from('\u001b[35mconsole.error\u001b[0m\n'),
            process.stderr,
        );
        assert.equal(output.includes('\u001b'), false);
        for (const char of output)
            assert.ok(
                char === '\n' ||
                    (char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126),
            );
        assert.match(output, /\[PASS\] \[API\] > API00001/);
        assert.match(output, /console.log\n/);
        assert.equal(errors, 'console.error\n');
    } finally {
        stdout.mock.restore();
        stderr.mock.restore();
    }
});

test('resolves environment controls with explicit options taking precedence', () => {
    const restoreEnv = environment({
        PLAYWRIGHT_MIXTAPE_COLOR_MODE: 'bw',
        PLAYWRIGHT_MIXTAPE_SHOW_LOGS: 'true',
        PLAYWRIGHT_MIXTAPE_THEME: 'compact',
        PLAYWRIGHT_MIXTAPE_ANIMATIONS: 'false',
    });
    try {
        const defaults = resolveOptions({});
        assert.equal(defaults.monochrome, true);
        assert.equal(defaults.colors, false);
        assert.equal(defaults.symbols, 'ascii');
        assert.equal(defaults.showLogs, true);
        assert.equal(defaults.theme, 'compact');
        assert.equal(defaults.animations, false);
        const explicit = resolveOptions({
            colorMode: 'color',
            showLogs: false,
            theme: 'cassette',
        });
        assert.equal(explicit.colors, true);
        assert.equal(explicit.monochrome, false);
        assert.equal(explicit.showLogs, false);
        assert.equal(explicit.theme, 'cassette');
        process.env.PLAYWRIGHT_MIXTAPE_COLOR_MODE = 'invalid';
        assert.throws(() => resolveOptions({}), /colorMode/);
        process.env.PLAYWRIGHT_MIXTAPE_COLOR_MODE = 'auto';
        process.env.PLAYWRIGHT_MIXTAPE_SHOW_LOGS = 'invalid';
        assert.throws(() => resolveOptions({}), /PLAYWRIGHT_MIXTAPE_SHOW_LOGS/);
    } finally {
        restoreEnv();
    }
});

test('uses a compact startup heading and clips animation to the available terminal width', (context) => {
    const restoreEnv = environment({ CI: undefined, TERM: 'xterm' });
    const restoreTTY = terminalSize(true, 32);
    context.mock.timers.enable({ apis: ['setInterval'] });
    let output = '';
    const stdout = mock.method(
        process.stdout,
        'write',
        (chunk: string | Uint8Array) => {
            output += chunk.toString();
            return true;
        },
    );
    const terminal = new Terminal(resolveOptions({ colorMode: 'color' }));
    try {
        terminal.header(1, 1);
        assert.match(
            stripVTControlCharacters(output),
            /Playwright Mixtape Reporter/,
        );
        output = '';
        terminal.start();
        for (const line of stripVTControlCharacters(output)
            .replaceAll('\r', '')
            .split('\n'))
            assert.ok(displayWidth(line) < 32, line);
    } finally {
        terminal.stop();
        stdout.mock.restore();
        restoreTTY();
        restoreEnv();
    }
});

test('isolates forwarded styles from reporter writes and the other stream while preserving chunked colors', () => {
    const output: string[] = [];
    const errors: string[] = [];
    const stdout = mock.method(
        process.stdout,
        'write',
        (value: string | Uint8Array) => {
            output.push(value.toString());
            return true;
        },
    );
    const stderr = mock.method(
        process.stderr,
        'write',
        (value: string | Uint8Array) => {
            errors.push(value.toString());
            return true;
        },
    );
    const terminal = new Terminal(
        resolveOptions({
            colorMode: 'color',
            showLogs: true,
            animations: false,
        }),
    );
    try {
        terminal.forward('\u001b[31', process.stdout);
        assert.deepEqual(output, []);
        terminal.forward('mred', process.stdout);
        assert.equal(output.at(-1), '\u001b[0m\u001b[31mred\u001b[0m');
        terminal.write('reporter result\n');
        terminal.forward('plain stderr\n', process.stderr);
        assert.equal(errors.at(-1), '\u001b[0mplain stderr\u001b[0m\n');
        terminal.forward(' still red\u001b[0m\n', process.stdout);
        assert.equal(
            output.at(-1),
            '\u001b[0m\u001b[31m still red\u001b[0m\u001b[0m\n',
        );
        terminal.forward('\u001b[8mvisible\n', process.stdout);
        assert.equal(output.at(-1), '\u001b[0mvisible\u001b[0m\n');
        terminal.stop();
        terminal.forward('next run\n', process.stdout);
        assert.equal(output.at(-1), '\u001b[0mnext run\u001b[0m\n');
    } finally {
        terminal.stop();
        stdout.mock.restore();
        stderr.mock.restore();
    }
});
