import { performance } from 'node:perf_hooks';
import { LiveRun } from '../dist/workers.js';
import { renderWorkerPanel } from '../dist/worker-panel.js';
import { linePatch } from '../dist/layout.js';

const run = new LiveRun();
run.reset(10_000, 10);
for (let slot = 0; slot < 10; slot++)
    run.begin(
        {
            title: `Worker ${slot + 1}: validate a Unicode journey 🎵`,
            expectedStatus: 'passed',
            retries: 1,
        },
        {
            parallelIndex: slot,
            workerIndex: slot,
            retry: 0,
            status: 'passed',
            duration: 0,
        },
    );
const paint = (value) => value;
let previous = renderWorkerPanel(run, 136, 36, 0, paint);
const samples = [];
let bytes = 0;
for (let frame = 0; frame < 1500; frame++) {
    const start = performance.now();
    const next = renderWorkerPanel(run, 136, 36, frame, paint);
    for (let row = 0; row < next.length; row++) {
        const patch = linePatch(previous[row] ?? '', next[row]);
        if (patch) bytes += Buffer.byteLength(patch.text);
    }
    previous = next;
    if (frame >= 100) samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(
    JSON.stringify(
        {
            node: process.version,
            platform: process.platform,
            workers: 10,
            frames: samples.length,
            medianMs: +samples[Math.floor(samples.length / 2)].toFixed(3),
            p95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(3),
            meanPatchBytes: Math.round(bytes / 1500),
            frameIntervalMs: 120,
            note: 'Synthetic render + diff cost; excludes terminal I/O, worker execution, and optional metrics sampling.',
        },
        null,
        2,
    ),
);
