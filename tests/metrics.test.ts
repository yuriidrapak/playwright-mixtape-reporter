import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request } from 'node:http';
import { EventEmitter } from 'node:events';
import { channel } from 'node:diagnostics_channel';
import { Socket } from 'node:net';
import type { BrowserContext } from '@playwright/test';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    MetricsMonitor,
    SystemCpu,
    metricsEnvironment,
} from '../src/metrics-monitor.ts';
import { WorkerMetrics } from '../src/metrics.ts';
import { LiveRun } from '../src/workers.ts';
import { renderWorkerPanel } from '../src/worker-panel.ts';
import { displayWidth } from '../src/layout.ts';
import { ResourceAnimation } from '../src/resource-display.ts';

test('metrics startup and teardown are idempotent and release socket and context listeners', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mixtape-lifecycle-'));
    const metrics = new WorkerMetrics(directory, 0);
    const socket = new Socket();
    const context = new EventEmitter();
    const req = Object.assign(new EventEmitter(), { socket });
    try {
        metrics.start();
        metrics.start();
        metrics.observeContext(context as unknown as BrowserContext);
        channel('http.client.request.start').publish({ request: req });
        assert.equal(socket.listenerCount('close'), 1);
        assert.equal(context.listenerCount('close'), 1);
        assert.equal(context.listenerCount('requestfinished'), 1);
        const stopped = metrics.stop();
        assert.equal(metrics.stop(), stopped);
        await stopped;
        assert.equal(socket.listenerCount('close'), 0);
        assert.equal(context.listenerCount('close'), 0);
        assert.equal(context.listenerCount('requestfinished'), 0);
        assert.equal(req.listenerCount('upgrade'), 0);
        assert.equal(req.listenerCount('close'), 0);
    } finally {
        await metrics.stop();
        socket.destroy();
        await rm(directory, { recursive: true, force: true });
    }
});

test('measures total system utilization across cores on a 0–100% scale', () => {
    let user = 100;
    let idle = 900;
    const cpu = new SystemCpu(() => [
        { times: { user, idle, nice: 0, sys: 0, irq: 0 } },
        { times: { user: user * 2, idle: idle * 2, nice: 0, sys: 0, irq: 0 } },
    ]);
    cpu.sample();
    assert.equal(cpu.available, false);
    user += 25;
    idle += 75;
    cpu.sample();
    assert.equal(cpu.value, 25);
    assert.equal(cpu.available, true);
    user += 100;
    cpu.sample();
    assert.equal(cpu.value, 100);
    idle += 100;
    cpu.sample();
    assert.equal(cpu.value, 0);
    cpu.reset();
    assert.equal(cpu.available, false);
    const unavailable = new SystemCpu(() => []);
    unavailable.sample();
    assert.equal(unavailable.available, false);
});

test('combines all worker byte deltas in one window, retaining handoff traffic and counting retry snapshots once', () => {
    let user = 100;
    const cpu = new SystemCpu(() => [
        { times: { user, idle: 1000, nice: 0, sys: 0, irq: 0 } },
    ]);
    cpu.sample();
    const monitor = new MetricsMonitor(cpu);
    const base = { startedAt: 1000, at: 2000, received: 2048, sent: 1024 };
    monitor.accept({ ...base, workerIndex: 0 });
    monitor.accept({ ...base, workerIndex: 1 });
    user += 10;
    monitor.sampleRates(2000);
    assert.deepEqual(monitor.current([0], 2000), {
        cpu: 100,
        received: 4096,
        sent: 2048,
        cpuAvailable: true,
        networkAvailable: true,
    });
    // Worker 1 still transfers bytes while only worker 0 is assigned a test.
    monitor.accept({ ...base, workerIndex: 0, at: 3000, received: 3072 });
    monitor.accept({ ...base, workerIndex: 1, at: 3000, received: 4096 });
    user += 10;
    monitor.sampleRates(3000);
    assert.equal(monitor.current([0], 3000).received, 3072);
    // A final old-process snapshot and its retry process share the next window.
    monitor.accept({ ...base, workerIndex: 1, at: 3500, received: 5120 });
    monitor.accept({ ...base, workerIndex: 1, at: 3500, received: 5120 });
    monitor.accept({
        ...base,
        workerIndex: 2,
        at: 4000,
        received: 1024,
        sent: 0,
    });
    user += 10;
    monitor.sampleRates(4000);
    assert.equal(monitor.current([2], 4000).received, 2048);
    assert.equal(monitor.current([99], 4000).networkAvailable, false);
    assert.equal(monitor.current([99], 4000).cpuAvailable, true);
    user += 10;
    monitor.sampleRates(5000);
    assert.equal(
        monitor.current([], 5000).received,
        0,
        'Unchanged finished-process snapshots cannot keep reporting traffic',
    );
    assert.equal(
        monitor.current([], 5000).cpu,
        100,
        'System CPU stays live when no test is assigned',
    );
});

test('observes actual HTTP traffic without consuming response bodies or leaking request data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'compact-metrics-test-'));
    const server = createServer((req, res) => {
        req.resume();
        req.on('end', () => res.end('response'.repeat(1024)));
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const metrics = new WorkerMetrics(directory, 7);
    metrics.start();
    try {
        const response = await new Promise<string>((resolve, reject) => {
            const req = request(
                `http://127.0.0.1:${address.port}/secret-url`,
                { method: 'POST', headers: { Authorization: 'secret-token' } },
                (res) => {
                    let body = '';
                    res.setEncoding('utf8');
                    res.on('data', (chunk: string) => {
                        body += chunk;
                    });
                    res.on('end', () => resolve(body));
                },
            );
            req.on('error', reject);
            req.end('private-body');
        });
        assert.equal(response, 'response'.repeat(1024));
        await metrics.stop();
        const raw = await readFile(join(directory, 'worker-7.json'), 'utf8');
        const sample = JSON.parse(raw) as {
            received: number;
            sent: number;
        };
        assert.ok(sample.received >= 8192);
        assert.ok(sample.sent >= 12);
        assert.doesNotMatch(raw, /secret|private|response|http/);
    } finally {
        await metrics.stop();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
    }
});

test('reads all worker snapshots, tolerates missing or malformed data, and cleans up its environment', async () => {
    const cpu = new SystemCpu(() => []);
    let now = 0;
    const monitor = new MetricsMonitor(cpu, () => now);
    const previous = process.env[metricsEnvironment];
    monitor.start();
    const directory = process.env[metricsEnvironment]!;
    const at = 1000;
    try {
        await writeFile(
            join(directory, 'worker-42.json'),
            JSON.stringify({
                workerIndex: 42,
                startedAt: at - 1000,
                at,
                received: 1024,
                sent: 0,
            }),
        );
        await writeFile(join(directory, 'worker-99.json'), '{broken');
        now = at;
        await monitor.poll();
        assert.deepEqual(monitor.current([42], at), {
            cpu: 0,
            received: 1024,
            sent: 0,
            cpuAvailable: false,
            networkAvailable: true,
        });
        assert.equal(monitor.current([99], at).networkAvailable, false);
        assert.equal(monitor.current([100], at).networkAvailable, false);
    } finally {
        monitor.stop();
    }
    assert.equal(process.env[metricsEnvironment], previous);
    await assert.rejects(access(directory));
});

test('fits live measured resource labels without breaking the retained panel at narrow widths', () => {
    const run = new LiveRun();
    run.reset(100, 6);
    const load = { cpu: 37.4, received: 2048, sent: 1024 * 1024 };
    for (const columns of [24, 40, 60, 80, 100, 136, 200]) {
        const panel = renderWorkerPanel(
            run,
            columns,
            30,
            0,
            (value) => value,
            load,
        );
        for (const row of panel) assert.ok(displayWidth(row) < columns, row);
        if (columns >= 80) {
            assert.match(panel[0]!, /0\/6 RUN.*00:00/);
            assert.match(panel[0]!, /CPU\(SYS\).*37%/);
            assert.match(panel[0]!, /NET .*↓0.02 ↑8.39 Mbit\/s/);
        }
    }
    const unavailable = renderWorkerPanel(
        run,
        136,
        30,
        0,
        (value) => value,
        null,
    )[0]!;
    assert.match(unavailable, /CPU\(SYS\).*--.*NET .*↓ *-- ↑ *-- Mbit\/s/);
});

test('damps measurements independently and preserves system CPU when worker network data is missing', () => {
    const animation = new ResourceAnimation();
    const burst = { cpu: 100, received: 500_000, sent: 20_000 };
    const zero = { cpu: 0, received: 0, sent: 0 };
    animation.next(burst, 0);
    const falling = animation.next(zero, 120)!;
    assert.ok(falling.received > 450_000 && falling.received < 500_000);
    const settled = animation.next(zero, 1000)!;
    assert.ok(
        settled.received > 300_000 && settled.received < falling.received,
    );
    const nextBurst = animation.next(
        { cpu: 50, received: 170_000, sent: 0 },
        1120,
    )!;
    assert.ok(
        nextBurst.received > 170_000 && nextBurst.received < settled.received,
    );
    assert.ok(nextBurst.history!.length >= 2);

    const coarse = new ResourceAnimation();
    coarse.next(burst, 0);
    assert.ok(
        Math.abs(coarse.next(zero, 1000)!.received - settled.received) < 0.001,
    );
    const missingNetwork = animation.next(
        { cpu: 50, received: 0, sent: 0, networkAvailable: false },
        1240,
    )!;
    assert.ok(missingNetwork.cpu > 0);
    assert.equal(missingNetwork.networkAvailable, false);
    assert.deepEqual(missingNetwork.history, []);
    assert.equal(animation.next(null, 1360), null);
    assert.deepEqual(animation.next(burst, 1480), {
        ...burst,
        history: [520_000],
        cpuAvailable: true,
        networkAvailable: true,
    });
});

test('keeps resource animation driven by measurements and preserves every runner in short terminals', () => {
    const run = new LiveRun(() => 1000);
    run.reset(100, 10);
    const metrics = {
        cpu: 50,
        received: 500_000,
        sent: 100_000,
        history: [0, 10_000, 100_000, 600_000],
    };
    const first = renderWorkerPanel(run, 100, 30, 0, (value) => value, metrics);
    const later = renderWorkerPanel(run, 100, 30, 5, (value) => value, metrics);
    assert.equal(
        first[0],
        later[0],
        'A frame tick alone must not fabricate resource activity',
    );
    assert.match(first[0]!, /[█▏▎▍▌▋▊▉]/);
    assert.match(first[0]!, /[▁▂▃▄▅▆▇]/);
    assert.match(first[0]!, /↓4.00 ↑0.80 Mbit\/s/);
    const pages = [0, 16].map((frame) =>
        renderWorkerPanel(run, 32, 8, frame, (value) => value, metrics),
    );
    assert.equal(pages.flat().join('\n').match(/⟦.-.⟧/g)?.length, 10);
    for (const page of pages) {
        assert.equal(page.length, 5);
        for (const line of page) assert.equal(displayWidth(line), 31);
    }
});
