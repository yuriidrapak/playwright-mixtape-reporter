import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { LiveRun, type WorkerResult, type WorkerTest } from '../src/workers.ts';
import { renderWorkerPanel } from '../src/worker-panel.ts';
import { palette, type Tone } from '../src/colors.ts';
import { displayWidth } from '../src/layout.ts';

function item(index = 0, retries = 0): WorkerTest {
    return {
        title: `API${(index + 1).toString().padStart(5, '0')} - Verify that a quote is returned`,
        expectedStatus: 'passed',
        retries,
    };
}

function result(
    parallelIndex = 0,
    workerIndex = parallelIndex,
    retry = 0,
    status: WorkerResult['status'] = 'passed',
): WorkerResult {
    return { parallelIndex, workerIndex, retry, status, duration: 1_500 };
}

const paint = (value: string, tone: Tone): string =>
    `\u001b[${palette[tone]}m${value}\u001b[0m`;
const plain = (run: LiveRun, columns = 80, rows = 24, frame = 0): string =>
    renderWorkerPanel(run, columns, rows, frame, (value) => value).join('\n');

test('shows actual parallel slots for 2, 3, 5, 6 and 10 configured workers', () => {
    for (const capacity of [2, 3, 5, 6, 10]) {
        let now = 0;
        const run = new LiveRun(() => now);
        run.reset(100, capacity);
        assert.equal(run.active, 0);
        assert.ok(plain(run).includes(`RUN ${'·'.repeat(capacity)}`));
        for (let slot = 0; slot < capacity; slot++)
            run.begin(item(slot), result(slot));
        assert.equal(run.active, capacity);
        assert.equal(run.peak, capacity);
        assert.equal(run.done, 0);
        now = 1_000;
        const output = plain(run);
        assert.ok(output.includes(`${capacity}/${capacity} RUN`));
        assert.ok(output.includes(`RUN ${'█'.repeat(capacity)}`));
        assert.doesNotMatch(
            output.split('\n')[0] ?? '',
            /SIDE A|TAPE DECK|PEAK|LOAD|BUSY|%/,
        );
        for (let slot = 0; slot < capacity; slot++)
            assert.ok(
                output.includes(`API${(slot + 1).toString().padStart(5, '0')}`),
            );
        assert.equal(output.match(/⟦.-.⟧/g)?.length, capacity);
        assert.doesNotMatch(
            output,
            /\bID\b|W\d{2}|\bSTATE\b|\bTAKES\b|\bCASSETTE\b/,
        );
        assert.match(output, /0\/100 DONE 0\.0%/);
        assert.doesNotMatch(output, /ATTEMPT|\[1\/\d+\]/);
    }
});

test('reuses the logical runner after retries restart the worker process and counts the case once', () => {
    let now = 0;
    const run = new LiveRun(() => now);
    const current = item(0, 1);
    run.reset(1, 1);
    run.begin(current, result());
    now = 1_500;
    run.end(current, result(0, 0, 0, 'failed'), 'failed');
    assert.equal(run.done, 0);
    assert.equal(run.counts.failed, 0);
    assert.equal(run.runners[0]?.phase, 'retry');
    assert.match(plain(run), /0\/1 RUN/);
    now += 1_000;
    assert.match(plain(run), /RUN ·/);
    assert.doesNotMatch(plain(run), /ATTEMPT|\[1\/2\]|\[2\/2\]/);
    run.begin(current, result(0, 10, 1));
    assert.match(plain(run), /1\/1 RUN/);
    now += 1_000;
    assert.match(plain(run), /RUN █/);
    assert.match(plain(run), /API00001.*\[2\/2\] │/);
    assert.match(plain(run), /ATTEMPT/);
    assert.equal(run.runners.length, 1);
    assert.equal(run.runners[0]?.workerIndex, 10);
    assert.equal(run.retries, 1);
    now += 1_000;
    run.end(current, result(0, 10, 1), 'flaky');
    assert.equal(run.done, 1);
    assert.equal(run.counts.flaky, 1);
    assert.equal(run.counts.failed, 0);
    assert.equal(run.peak, 1);
    assert.match(plain(run), /1\/1 DONE 100\.0%/);
    assert.doesNotMatch(plain(run), /API00001|\[2\/2\]/);
    assert.match(plain(run), /--:-- awaiting test/);
    assert.match(
        plain(run),
        /ATTEMPT/,
        'Keep the column stable once a retry has started',
    );
});

test('measures elapsed execution and completion independently of the animation position', () => {
    let now = 0;
    const run = new LiveRun(() => now);
    const current = item();
    run.reset(5, 3);
    run.begin(current, result());
    now = 65_000;
    assert.match(plain(run), /01:05/);
    assert.match(plain(run), /0\/5 DONE 0\.0%/);
    run.end(current, result(), 'passed');
    assert.equal(run.active, 0);
    now += 1_000;
    assert.match(plain(run), /RUN ···/);
    assert.match(plain(run), /1\/5 DONE 20\.0%/);
    const stationary = plain(run, 80, 24, 0);
    assert.equal(
        plain(run, 80, 24, 4),
        stationary,
        'Idle runners must not animate',
    );
});

test('does not let synthetic skipped results or old processes replace an active runner', () => {
    const run = new LiveRun(() => 0);
    const old = item(0, 1);
    const current = item(1);
    run.reset(4, 1);
    run.begin(old, result());
    run.end(old, result(0, 0, 0, 'failed'), 'failed');
    run.begin(current, result(0, 9));
    run.end(item(2), result(0, -1, 0, 'skipped'), 'skipped');
    run.end(old, result(0, 0, 0, 'failed'), 'failed');
    assert.equal(run.active, 1);
    assert.equal(run.runners[0]?.test, current);
    assert.equal(run.runners[0]?.workerIndex, 9);
    assert.equal(run.done, 1);
    assert.equal(run.counts.skipped, 1);
});

test('spins both cassette reels only for busy runners with stable state colors', () => {
    let now = 0;
    const run = new LiveRun(() => now);
    run.reset(2, 2);
    run.begin(item(), result());
    now = 1_000;
    const first = renderWorkerPanel(run, 100, 24, 0, paint);
    const second = renderWorkerPanel(run, 100, 24, 2, paint);
    const busy1 =
        first.find((line) =>
            stripVTControlCharacters(line).includes('API00001'),
        ) ?? '';
    const busy2 =
        second.find((line) =>
            stripVTControlCharacters(line).includes('API00001'),
        ) ?? '';
    assert.notEqual(
        stripVTControlCharacters(busy1),
        stripVTControlCharacters(busy2),
    );
    assert.equal(
        first[0],
        second[0],
        'Load must remain full while the same test is running',
    );
    assert.match(stripVTControlCharacters(first[0] ?? ''), /RUN █·/);
    const footer = first.at(-1) ?? '';
    assert.ok(footer.includes(`\u001b[${palette.green}mPASS 0\u001b[0m`));
    assert.ok(footer.includes(`\u001b[${palette.red}mFAIL 0\u001b[0m`));
    assert.ok(footer.includes(`\u001b[${palette.yellow}mFLAKY 0\u001b[0m`));
    assert.equal(
        first.find((line) => line.includes('awaiting test')),
        second.find((line) => line.includes('awaiting test')),
    );
    const codes = (value: string): string[] =>
        value
            .split('\u001b[')
            .slice(1)
            .map((part) => part.slice(0, part.indexOf('m')));
    assert.deepEqual(codes(busy1), codes(busy2));
    assert.ok(busy1.includes(`\u001b[${palette.teal}m`));
    assert.ok(
        (first.find((line) => line.includes('awaiting test')) ?? '').includes(
            `\u001b[${palette.muted}m`,
        ),
    );
});

test('fits 10 runner slots in narrow, short and wide terminals without wrapping the panel', () => {
    const run = new LiveRun(() => 0);
    run.reset(20, 10);
    for (let slot = 0; slot < 10; slot++) {
        const current = item(slot, 2);
        current.title +=
            ' when 測試 preserves selected extras and the complete booking configuration'.repeat(
                2,
            );
        run.begin(current, result(slot, slot, slot === 9 ? 1 : 0));
    }
    for (const [columns, rows] of [
        [32, 24],
        [80, 8],
        [80, 24],
        [160, 24],
    ] as const) {
        const lines = renderWorkerPanel(run, columns, rows, 0, paint);
        assert.ok(lines.length <= rows - 3);
        for (const line of lines)
            assert.ok(
                displayWidth(line) < columns,
                stripVTControlCharacters(line),
            );
        const output = stripVTControlCharacters(lines.join('\n'));
        assert.equal(
            output.match(/⟦.-.⟧/g)?.length,
            10,
            `${columns}x${rows}: ${output}`,
        );
        assert.doesNotMatch(output, /W\d{2}|\bSTATE\b|\bTAKES\b|\bCASSETTE\b/);
        const header = stripVTControlCharacters(
            lines.find((line) => line.includes('CURRENT TEST')) ?? '',
        );
        if (header) {
            const rightEdge = displayWidth(
                header.slice(
                    0,
                    header.lastIndexOf('ATTEMPT') + 'ATTEMPT'.length,
                ),
            );
            for (const row of output
                .split('\n')
                .filter((line) => line.includes('API000'))) {
                assert.ok(
                    row.includes('…'),
                    'Long titles should leave room for the attempt column',
                );
                assert.doesNotMatch(row, /\[1\/\d+\]/);
                if (!row.includes('[2/3]')) continue;
                const attemptEnd = row.lastIndexOf('[2/3]') + '[2/3]'.length;
                assert.equal(
                    displayWidth(row.slice(0, attemptEnd)),
                    rightEdge,
                    row,
                );
            }
        }
    }
});

test('keeps workers in a single ordered full-width table across the old wide-terminal breakpoint', () => {
    const run = new LiveRun(() => 1_000);
    run.reset(981, 6);
    const titles = Array.from(
        { length: 6 },
        (_, slot) =>
            `API${String(11 + slot).padStart(5, '0')} - Verify that the booking confirmation share returns 204 with no body and keeps the selected extras`,
    );
    titles.forEach((title, slot) =>
        run.begin(
            { title, expectedStatus: 'passed', retries: 1 },
            result(slot, slot, slot === 5 ? 1 : 0),
        ),
    );
    for (const columns of [136, 137, 160, 196]) {
        const lines = renderWorkerPanel(run, columns, 32, 0, (value) => value);
        const output = lines.join('\n');
        assert.equal((output.match(/CURRENT TEST/g) ?? []).length, 1);
        assert.equal((output.match(/ATTEMPT/g) ?? []).length, 1);
        const lanes = lines.filter((line) => line.includes('API000'));
        assert.equal(lanes.length, 6);
        lanes.forEach((line, slot) => {
            assert.equal((line.match(/API000/g) ?? []).length, 1);
            assert.ok(
                line.includes(`API${String(11 + slot).padStart(5, '0')}`),
            );
            if (columns >= 160) assert.ok(line.includes(titles[slot]!), line);
            assert.equal(
                (line.match(/│/g) ?? []).length,
                2,
                'No internal table divider',
            );
            assert.equal(displayWidth(line), columns - 1);
            if (slot === 5) assert.match(line, /\[2\/2\] │$/);
            else assert.doesNotMatch(line, /\[1\/2\]|\[2\/2\]/);
        });
        assert.equal(
            lines.length,
            10,
            'Expanding the viewport must not regroup workers',
        );
    }
});

test('expected failures and interrupted results preserve their actual final classifications', () => {
    const run = new LiveRun(() => 0);
    const known = { ...item(), expectedStatus: 'failed' as const };
    const stopped = item(1);
    run.reset(2, 2);
    run.begin(known, result());
    run.begin(stopped, result(1));
    run.end(known, result(0, 0, 0, 'failed'), 'passed');
    run.end(stopped, result(1, 1, 0, 'interrupted'), 'interrupted');
    assert.equal(run.done, 2);
    assert.equal(run.counts.passed, 1);
    assert.equal(run.counts.interrupted, 1);
    assert.equal(run.active, 0);
    run.end(known, result(0, 0, 0, 'failed'), 'passed');
    assert.equal(run.done, 2);
    assert.equal(run.counts.passed, 1, 'Repeated events must not double-count');
});

test('pages real runner states when a short narrow terminal cannot display every lane at once', () => {
    const run = new LiveRun(() => 0);
    run.reset(10, 10);
    for (let slot = 0; slot < 10; slot++) run.begin(item(slot), result(slot));
    const outputs = [0, 16].map((frame) =>
        renderWorkerPanel(run, 32, 8, frame, (value) => value),
    );
    outputs.forEach((lines, page) => {
        assert.ok(lines.length <= 5);
        assert.ok(lines[0]?.includes(`PAGE ${page + 1}/2`));
        for (const line of lines) assert.ok(displayWidth(line) < 32, line);
    });
    const all = outputs.flat().join('\n');
    assert.equal(all.match(/⟦.-.⟧/g)?.length, 10);
    assert.doesNotMatch(all, /W\d{2}|\bSTATE\b|\bTAKES\b|\bCASSETTE\b/);
    assert.equal(run.done, 0);
});

test('clears completed workers and shows a fresh smooth ramp even for immediate handoffs', () => {
    let now = 0;
    const run = new LiveRun(() => now);
    const first = item(0);
    const second = item(1);
    const next = item(2);
    run.reset(3, 2);
    run.begin(first, result());
    assert.equal(run.loadFor(run.runners[0]!), 0);
    assert.match(plain(run), /1\/2 RUN ··/);

    now = 120;
    assert.equal(
        run.loadFor(run.runners[0]!),
        0,
        'The handoff must remain visible for one redraw',
    );
    now = 480;
    const rising = run.loadFor(run.runners[0]!);
    assert.ok(rising > 0 && rising < 1);
    assert.match(plain(run), /RUN [▁▂▃▄▅▆▇]·/);
    assert.equal(
        plain(run, 80, 24, 0).split('\n')[0],
        plain(run, 80, 24, 100).split('\n')[0],
    );

    now = 1_000;
    assert.match(plain(run), /RUN █·/);
    run.begin(second, result(1));
    now = 1_480;
    assert.match(plain(run), /RUN █[▁▂▃▄▅▆▇]/);
    now = 2_000;
    assert.match(plain(run), /RUN ██/);

    run.end(first, result(), 'passed');
    assert.equal(run.active, 1);
    assert.equal(
        run.loadFor(run.runners[0]!),
        0,
        'Completed work must not leave a full bar',
    );
    assert.match(plain(run), /1\/2 RUN ·█/);
    run.begin(next, result());
    assert.equal(run.active, 2);
    assert.equal(
        run.loadFor(run.runners[0]!),
        0,
        'Back-to-back tests must not inherit the previous full bar',
    );
    assert.match(plain(run), /2\/2 RUN ·█/);
    now = 2_120;
    assert.equal(run.loadFor(run.runners[0]!), 0);
    now = 2_480;
    assert.match(plain(run), /RUN [▁▂▃▄▅▆▇]█/);
    now = 3_000;
    assert.match(plain(run), /RUN ██/);

    run.end(next, result(), 'passed');
    run.end(second, result(1), 'passed');
    assert.equal(run.active, 0);
    assert.match(plain(run), /0\/2 RUN ··/);
    now = 4_000;
    assert.match(plain(run), /RUN ··/);
    run.release();
    assert.equal(run.loadFor(run.runners[0]!), 0);
});

test('keeps real per-worker handoff animation in the combined CPU and network status line', () => {
    let now = 0;
    const run = new LiveRun(() => now);
    const first = item();
    run.reset(10, 2);
    const resources = {
        cpu: 12,
        received: 81_250,
        sent: 11_250,
        history: [0, 20_000, 81_250],
    };
    const header = (columns = 100) =>
        renderWorkerPanel(run, columns, 24, 0, (value) => value, resources)[0]!;
    run.begin(first, result());
    assert.match(
        header(),
        /1\/2 RUN ··.*CPU\(SYS\).*12%.*NET.*↓0.65 ↑0.09 Mbit\/s.*00:00/,
    );
    const styled = renderWorkerPanel(run, 136, 24, 0, paint, resources)[0]!;
    assert.ok(styled.includes(`\u001b[${palette.lavender}m1/2 RUN `));
    assert.ok(styled.includes(`\u001b[${palette.amber}m 12%`));
    assert.ok(styled.includes(`\u001b[${palette.teal}m↓0.65`));
    assert.ok(styled.includes(`\u001b[${palette.lavender}m↑0.09`));
    now = 480;
    assert.match(header(), /1\/2 RUN [▁▂▃▄▅▆▇]·/);
    now = 1000;
    assert.match(header(), /1\/2 RUN █·/);
    run.end(first, result(), 'passed');
    run.begin(item(1), result());
    assert.match(header(), /1\/2 RUN ··/);
    now = 1480;
    assert.match(header(), /1\/2 RUN [▁▂▃▄▅▆▇]·/);
    for (const columns of [24, 40, 60, 80, 100, 136, 200])
        assert.ok(displayWidth(header(columns)) < columns);
});
