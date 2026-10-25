import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';
import { TerminalControls } from '../src/controls.ts';
import { LiveRun } from '../src/workers.ts';
import { renderWorkerPanel } from '../src/worker-panel.ts';
import { displayWidth } from '../src/layout.ts';

function inputTTY() {
    const input = new PassThrough() as PassThrough & {
        isTTY: boolean;
        isRaw: boolean;
        setRawMode(value: boolean): void;
    };
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = (value) => {
        input.isRaw = value;
    };
    input.pause();
    return input;
}

test('selects workers, inspects retries, holds periodic updates and restores input on stop or Ctrl+C', () => {
    const input = inputTTY();
    let changes = 0;
    let interrupts = 0;
    const controls = new TerminalControls(
        () => 3,
        () => {
            changes++;
        },
        input as unknown as NodeJS.ReadStream,
        () => {
            interrupts++;
        },
    );
    const key = (value: string) => input.emit('data', Buffer.from(value));
    controls.start();
    assert.equal(controls.view.enabled, true);
    assert.equal(input.isRaw, true);
    key('\u001b[B');
    assert.equal(controls.view.selected, 0);
    key('\u001b[A');
    assert.equal(controls.view.selected, 2);
    key('\r');
    assert.equal(controls.view.inspecting, true);
    key('p');
    assert.equal(controls.view.held, true);
    key('p');
    assert.equal(controls.view.held, false);
    key('\u001b[B');
    assert.equal(controls.view.selected, 0);
    assert.equal(changes, 6);
    controls.stop();
    assert.equal(input.isRaw, false);
    assert.equal(input.isPaused(), true);
    assert.equal(input.listenerCount('data'), 0);
    controls.start();
    assert.equal(
        controls.view.enabled,
        true,
        'A second run can safely reuse the input',
    );
    key('\u0003');
    assert.equal(interrupts, 1);
    assert.equal(input.isRaw, false);
    assert.equal(controls.view.enabled, false);
    assert.equal(input.listenerCount('data'), 0);
    input.destroy();
});

test('does not claim redirected input or interfere with another input owner', () => {
    for (const state of ['redirected', 'raw', 'listener'] as const) {
        const input = inputTTY();
        if (state === 'redirected') input.isTTY = false;
        if (state === 'raw') input.isRaw = true;
        const existing = () => {};
        if (state === 'listener') input.on('data', existing);
        const controls = new TerminalControls(
            () => 1,
            () => {},
            input as unknown as NodeJS.ReadStream,
        );
        controls.start();
        assert.equal(controls.view.enabled, false);
        controls.stop();
        assert.equal(input.isRaw, state === 'raw');
        assert.equal(
            input.listeners('data').includes(existing),
            state === 'listener',
        );
        input.destroy();
    }
});

test('inspects the selected retry without reviving finished titles and follows selection when paging', () => {
    const run = new LiveRun(() => 1000);
    run.reset(10, 10);
    for (let slot = 0; slot < 10; slot++)
        run.begin(
            {
                title: `API${String(slot).padStart(5, '0')} - Verify that a test completes when a very long selected case title wraps over more than one line`,
                expectedStatus: 'passed',
                retries: 1,
                location: {
                    file: '/tmp/tests/example.spec.ts',
                    line: 42,
                    column: 3,
                },
            },
            {
                workerIndex: slot,
                parallelIndex: slot,
                retry: slot === 9 ? 1 : 0,
                status: 'passed',
                duration: 0,
            },
        );
    const view = { enabled: true, selected: 9, inspecting: true, held: false };
    for (const [columns, rows] of [
        [32, 24],
        [80, 24],
        [136, 32],
        [32, 8],
    ]) {
        const panel = renderWorkerPanel(
            run,
            columns!,
            rows!,
            0,
            (value) => value,
            undefined,
            view,
        );
        assert.ok(panel.length <= rows! - 3);
        for (const line of panel)
            assert.ok(displayWidth(line) < columns!, line);
        assert.match(panel.at(-1)!, /\[p\] hold display/);
        if (rows! >= 24) {
            assert.match(panel.join('\n'), /DETAILS/);
            assert.match(panel.join('\n'), /Attempt 2\/2/);
            assert.match(panel.join('\n'), /example.spec.ts:42:3/);
        }
        if (columns === 32) assert.match(panel.join('\n'), /›⟦/);
    }
    const selected = run.runners[9]!;
    run.end(
        selected.test!,
        {
            workerIndex: 9,
            parallelIndex: 9,
            retry: 1,
            status: 'passed',
            duration: 1000,
        },
        'flaky',
    );
    const output = renderWorkerPanel(
        run,
        136,
        32,
        0,
        (value) => value,
        undefined,
        view,
    ).join('\n');
    assert.doesNotMatch(output, /API00009/);
    assert.match(output, /Worker available/);
});
