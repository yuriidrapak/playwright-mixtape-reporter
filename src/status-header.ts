import { displayWidth } from './layout.ts';
import type { Tone } from './colors.ts';
import type { LiveRun } from './workers.ts';
import type { ResourceDisplay } from './resource-display.ts';

type Paint = (value: string, tone: Tone) => string;
const levels = ['·', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** Each slot keeps its original handoff delay and smooth new-attempt ramp. */
function activity(run: LiveRun, cells: number, paint: Paint): string {
    let graph = '';
    for (let cell = 0; cell < cells; cell++) {
        const start = Math.floor((cell * run.runners.length) / cells);
        const end = Math.floor(((cell + 1) * run.runners.length) / cells);
        let load = 0;
        for (let slot = start; slot < end; slot++) {
            const runner = run.runners[slot];
            if (runner) load = Math.max(load, run.loadFor(runner));
        }
        const level = Math.round(load * 8);
        graph += paint(levels[level]!, level ? 'teal' : 'muted');
    }
    return graph;
}

function cpuMeter(
    metrics: ResourceDisplay | null,
    cells: number,
    paint: Paint,
): string {
    if (!metrics || metrics.cpuAvailable === false)
        return paint('·'.repeat(cells), 'muted');
    const filled = Math.min(1, Math.max(0, metrics.cpu / 100)) * cells;
    let graph = '';
    for (let cell = 0; cell < cells; cell++) {
        const level = Math.round(Math.min(1, Math.max(0, filled - cell)) * 8);
        graph += level === 8 ? '█' : level === 0 ? '·' : '▏▎▍▌▋▊▉'[level - 1];
    }
    return paint(graph, 'amber');
}

function traffic(
    metrics: ResourceDisplay | null,
    cells: number,
    paint: Paint,
): string {
    const samples =
        !metrics || metrics.networkAvailable === false
            ? []
            : (metrics.history ?? [metrics.received + metrics.sent]);
    const graph = samples
        .slice(-cells)
        .map(
            (value) =>
                levels[
                    value > 0
                        ? Math.max(
                              1,
                              Math.round(Math.min(1, value / 1_000_000) * 8),
                          )
                        : 0
                ]!,
        )
        .join('');
    return (
        paint('·'.repeat(Math.max(0, cells - graph.length)), 'muted') +
        paint(graph, 'teal')
    );
}

export function clock(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1_000);
    return `${Math.floor(seconds / 60)
        .toString()
        .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

/** Compose colored fields before choosing a layout; never wrap or split a metric. */
export function renderStatusHeader(
    run: LiveRun,
    width: number,
    pageLabel: string,
    paint: Paint,
    metrics?: ResourceDisplay | null,
): string {
    const separator = paint(' │ ', 'muted');
    const time = paint(clock(run.elapsed), 'lavender');
    const fullRun = `${run.active}/${run.runners.length} RUN${pageLabel} `;
    const shortRun = `${run.active}/${run.runners.length}${pageLabel} `;
    const cpu =
        metrics && metrics.cpuAvailable !== false
            ? `${Math.round(metrics.cpu)}%`
            : '--';
    const cpuValue = paint(cpu.padStart(4), 'amber');
    const networkKnown = metrics && metrics.networkAvailable !== false;
    const down = networkKnown
        ? ((metrics.received * 8) / 1_000_000).toFixed(2)
        : '--';
    const up = networkKnown
        ? ((metrics.sent * 8) / 1_000_000).toFixed(2)
        : '--';
    const rates =
        paint(`↓${down.padStart(4)}`, 'teal') +
        ' ' +
        paint(`↑${up.padStart(4)}`, 'lavender') +
        paint(' Mbit/s', 'muted');
    const cpuField = (cells: number): string =>
        paint('CPU(SYS) ', 'muted') +
        (cells ? cpuMeter(metrics ?? null, cells, paint) + ' ' : '') +
        cpuValue;
    const netField = (cells: number): string =>
        paint('NET ', 'muted') +
        (cells ? traffic(metrics ?? null, cells, paint) + ' ' : '') +
        rates;
    const candidates: Array<readonly [string, string]> = [];
    if (metrics !== undefined) {
        for (const [cpuCells, netCells] of [
            [6, 8],
            [4, 4],
            [0, 0],
        ] as const)
            candidates.push([
                fullRun,
                separator +
                    cpuField(cpuCells) +
                    separator +
                    netField(netCells) +
                    separator +
                    time,
            ]);
        candidates.push(
            [
                shortRun,
                separator +
                    paint('CPU ', 'muted') +
                    cpuValue +
                    separator +
                    rates +
                    separator +
                    time,
            ],
            [shortRun, separator + rates + separator + time],
            [
                shortRun,
                separator +
                    paint('CPU ', 'muted') +
                    cpuValue +
                    separator +
                    time,
            ],
        );
    }
    candidates.push(
        [fullRun, separator + time],
        [shortRun, ' ' + time],
        [shortRun, ''],
    );
    for (const [prefix, suffix] of candidates) {
        const room = width - displayWidth(prefix) - displayWidth(suffix);
        if (room < Math.min(4, Math.max(1, run.runners.length))) continue;
        const cells = Math.min(Math.max(1, run.runners.length), 16, room);
        return paint(prefix, 'lavender') + activity(run, cells, paint) + suffix;
    }
    return paint(`${run.active}/${run.runners.length}${pageLabel}`, 'lavender');
}
