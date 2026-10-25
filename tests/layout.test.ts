import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import {
    displayWidth,
    fitPath,
    hangingIndent,
    indentLines,
    linePatch,
} from '../src/layout.ts';

test('keeps wrapped descriptions aligned under the text after the icon', () => {
    const body =
        'API00004 - Verify that the completed booking keeps the final price and selected extras when edited before checkout (17s)';
    const output = hangingIndent('  ✅ ', body, 52);
    const lines = output.trimEnd().split('\n');
    assert.ok(lines.length > 1);
    assert.match(lines[0] ?? '', /^ {2}✅ API00004/);
    for (const line of lines.slice(1))
        assert.ok(line.startsWith(' '.repeat(5)));
    for (const line of lines) assert.ok(displayWidth(line) <= 52, line);
    assert.equal(
        lines
            .map((line, index) =>
                index ? line.trimStart() : line.slice('  ✅ '.length),
            )
            .join(' '),
        body,
    );
});

test('hard-wraps long unbroken text without splitting ANSI styles', () => {
    const body = '\u001b[96mABCDEFGHIJKLMNOPQRSTUVWXYZ\u001b[0m';
    const output = hangingIndent('  ✅ ', body, 15);
    assert.deepEqual(stripVTControlCharacters(output).trimEnd().split('\n'), [
        '  ✅ ABCDEFGHIJ',
        '     KLMNOPQRST',
        '     UVWXYZ',
    ]);
    assert.equal(output.split('\u001b[96m').length, 2);
    assert.equal(output.split('\u001b[0m').length, 2);
});

test('counts emoji cells, combining marks and wide characters without splitting graphemes', () => {
    assert.equal(displayWidth('✅'), 2);
    assert.equal(displayWidth('⏩'), 2);
    assert.equal(displayWidth('Cafe\u0301 €30'), 8);
    assert.equal(displayWidth('測試'), 4);
    assert.equal(displayWidth('👩🏽‍💻'), 2);
    assert.equal(displayWidth('👨‍👩‍👧‍👦'), 2);
    const body = '\u001b[96mCafe\u0301 測試👩🏽‍💻測試👨‍👩‍👧‍👦 🇪🇸 €30\u001b[0m';
    const prefix = '  ✅ ';
    const lines = hangingIndent(prefix, body, 17).trimEnd().split('\n');
    for (const line of lines) assert.ok(displayWidth(line) <= 17, line);
    const plainLines = lines
        .map(stripVTControlCharacters)
        .map((line, index) =>
            line.slice(index ? displayWidth(prefix) : prefix.length),
        );
    assert.equal(
        plainLines.join('').replaceAll(' ', ''),
        stripVTControlCharacters(body).replaceAll(' ', ''),
    );
    const clusters = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const original = Array.from(
        clusters.segment(stripVTControlCharacters(body)),
        (item) => item.segment,
    ).filter((value) => value !== ' ');
    const wrapped = plainLines
        .flatMap((line) =>
            Array.from(clusters.segment(line), (item) => item.segment),
        )
        .filter((value) => value !== ' ');
    assert.deepEqual(wrapped, original);
});

test('retains internal spacing and does not add continuation lines to short entries', () => {
    assert.equal(
        hangingIndent('  ✅ ', 'API00001  - Verify quote (42ms)', 80),
        '  ✅ API00001  - Verify quote (42ms)\n',
    );
});

test('patches changed cells without repainting stable text, styles or graphemes', () => {
    const before = '\u001b[38;5;116m⟦⠋-⠸⟧\u001b[0m 00:09 測試 ✅ Cafe\u0301';
    const after = '\u001b[38;5;116m⟦⠙-⠼⟧\u001b[0m 00:09 測試 ✅ Cafe\u0301';
    const patch = linePatch(before, after)!;
    assert.equal(patch.column, 1);
    assert.equal(stripVTControlCharacters(patch.text), '⠙-⠼');
    assert.ok(patch.text.includes('\u001b[38;5;116m'));
    assert.equal(linePatch(after, after), undefined);
    const style = linePatch(
        '\u001b[32mPASS\u001b[0m',
        '\u001b[31mPASS\u001b[0m',
    )!;
    assert.equal(style.column, 0);
    assert.ok(style.text.includes('\u001b[31m'));
    assert.equal(stripVTControlCharacters(style.text), 'PASS');
    const wide = linePatch('測試👩🏽‍💻e\u0301 end', '測試✅e\u0301 end')!;
    assert.equal(wide.column, 4);
    assert.equal(stripVTControlCharacters(wide.text), '✅');
    const shorter = linePatch('old title here', 'new')!;
    assert.equal(stripVTControlCharacters(shorter.text), 'new           ');
});

test('fits long diagnostic paths without splitting the filename into continuation lines', () => {
    const paths = [
        '/Users/example/projects/automation-suite/api-tests/test-results/mixtape-reporter/issues.log',
        'C:\\Users\\Example User\\example-automation-suite\\api-tests\\test-results\\mixtape-reporter\\issues.log',
    ];
    for (const path of paths)
        for (const columns of [24, 32, 80, 92]) {
            for (const ascii of [false, true]) {
                const text = fitPath(path, columns, ascii);
                assert.ok(displayWidth(text) <= columns);
                assert.ok(text.endsWith('issues.log'));
                assert.equal(text.includes('\n'), false);
                if (ascii) assert.equal(text.includes('…'), false);
            }
        }
    assert.equal(
        fitPath('test-results/issues.log', 80),
        'test-results/issues.log',
    );
    assert.ok(
        displayWidth(fitPath('/tmp/' + '測試'.repeat(40) + '.log', 24)) <= 24,
    );
    assert.ok(
        fitPath(
            '/tmp/' + 'very-long-filename-'.repeat(20) + '.log',
            24,
        ).endsWith('.log'),
    );
});

test('keeps wrapped error and stack lines beneath their original indentation', () => {
    const text =
        'Error: delete isolated catalog fixture\n\nExpected: 204\nReceived: 502\n    at Object.base.extend.ownedCatalog.timeout (/Users/example/git/example-automation-suite/api-tests/src/fixtures/ownedCatalogTest.ts:83:23)';
    const lines = indentLines(text, 5, 79).split('\n');
    for (const line of lines) {
        assert.ok(line.startsWith('     '));
        assert.ok(displayWidth(line) <= 79, line);
    }
    const stack = lines.slice(
        lines.findIndex((line) => line.includes('at Object')),
    );
    assert.ok(stack.length > 1);
    for (const line of stack) assert.ok(line.startsWith('         '));
    assert.equal(lines.filter((line) => !line.trim()).length, 1);
});
