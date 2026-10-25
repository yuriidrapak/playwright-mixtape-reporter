import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OutputSanitizer } from '../src/output-sanitizer.ts';
import { singleLine } from '../src/format.ts';
import { resolveOptions, type MixtapeReporterOptions } from '../src/options.ts';

test('sanitizes labels before layout without leaving escape payloads or bidi controls', () => {
    assert.equal(
        singleLine('\u001b[31mhello\u001b[0m\nworld\u202e'),
        'hello world',
    );
    assert.equal(
        singleLine('safe\u001b]52;c;clipboard\u0007 title'),
        'safe title',
    );
});

test('removes terminal commands across every chunk boundary, retaining only opted-in colors', () => {
    const input =
        'start\u001b]52;c;clipboard\u0007\u001b[2J\u001b[8;1H\u001bPpayload\u001b\\\u009dsecret\u009c\u001b[31mred\u001b[0m\u202esafe\n';
    for (let split = 0; split <= input.length; split++) {
        const plain = new OutputSanitizer();
        assert.equal(
            plain.write(input.slice(0, split)) +
                plain.write(input.slice(split)),
            'startredsafe\n',
        );
        const color = new OutputSanitizer(true);
        assert.equal(
            color.write(input.slice(0, split)) +
                color.write(input.slice(split)),
            'start\u001b[31mred\u001b[0msafe\n',
        );
    }
});

test('preserves UTF-8 split across buffers and discards arbitrarily long control strings', () => {
    const filter = new OutputSanitizer(true);
    const bytes = Buffer.from('Привіт 🎵\n');
    assert.equal(
        Array.from(bytes, (byte) => filter.write(Buffer.from([byte]))).join(''),
        'Привіт 🎵\n',
    );
    assert.equal(filter.write('\u001b]52;c;'), '');
    for (let i = 0; i < 100; i++)
        assert.equal(filter.write('x'.repeat(1024)), '');
    assert.equal(filter.write('\u001b\\visible\n'), 'visible\n');
    assert.equal(filter.write('\u001b[' + '1;'.repeat(1000) + 'mtext'), 'text');
});

test('validates JavaScript options before reporter startup', () => {
    for (const invalid of [
        null,
        [],
        { showLogs: 'false' },
        { symbols: 'unknown' },
        { title: 123 },
        { outputFile: '' },
        { outputFile: '\0' },
        { includeOutputInDiagnostics: 'false' },
        { redactDiagnosticText: true },
        { maxDiagnosticBytes: 0 },
        { maxDiagnosticBytes: 1023 },
        { maxDiagnosticBytes: 1024.5 },
        { maxDiagnosticBytes: Infinity },
    ])
        assert.throws(() =>
            resolveOptions(invalid as unknown as MixtapeReporterOptions),
        );
    assert.equal(
        resolveOptions({ outputFile: false, symbols: 'ascii' }).outputFile,
        false,
    );
});

test('allows bounded colors and basic styles but rejects concealment, blink and malformed extended colors', () => {
    for (const sequence of [
        '8',
        '5',
        '6',
        '7',
        '28',
        '31;8',
        '1:8',
        '38;2;256;0;0',
        '38;5',
        '38:2:1:2',
        '48:2:1:0:0:0',
        '999',
    ]) {
        const input = `\u001b[${sequence}mvisible`;
        for (let split = 0; split <= input.length; split++) {
            const filter = new OutputSanitizer(true);
            assert.equal(
                filter.write(input.slice(0, split)) +
                    filter.write(input.slice(split)),
                'visible',
            );
            assert.equal(filter.style, '');
        }
    }
    for (const sequence of [
        '1;3;4;31',
        '38;5;8',
        '48;2;8;5;7',
        '38:2::8:5:7',
        '48:2:0:8:5:7',
        '38:5:255',
        '90;107',
    ]) {
        const filter = new OutputSanitizer(true);
        assert.equal(
            filter.write(`\u001b[${sequence}mcolor`),
            `\u001b[${sequence}mcolor`,
        );
        assert.ok(filter.style.length < 100);
        filter.write('\u001b[0m');
        assert.equal(filter.style, '');
    }
    const filter = new OutputSanitizer(true);
    for (let i = 0; i < 1000; i++)
        filter.write('\u001b[1;2;3;4;38;5;100;48;2;1;2;3m');
    assert.ok(filter.style.length < 100);
    filter.write('\u001b[22;23;24;39;49m');
    assert.equal(filter.style, '');
});
