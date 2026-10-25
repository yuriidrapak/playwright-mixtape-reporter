import {
    displayWidth,
    fitPath,
    hangingIndent,
    truncateCells,
} from './layout.ts';
import { relative } from 'node:path';
import { singleLine } from './format.ts';
import type { Tone } from './colors.ts';
import type { LiveRun, Phase, Runner } from './workers.ts';
import type { ResourceDisplay } from './resource-display.ts';
import { renderStatusHeader, clock } from './status-header.ts';
import type { PanelView } from './controls.ts';

type Paint = (value: string, tone: Tone) => string;
const reels = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const tapeWidth = 5;
const attemptHeading = 'ATTEMPT';
const counterTones: Record<string, Tone> = {
    PASS: 'green',
    FAIL: 'red',
    FLAKY: 'yellow',
    SKIP: 'lavender',
    RETRIES: 'amber',
};

/** Dot-matrix reels rotate only while a test executes; colors stay semantic. */
function cassette(runner: Runner, frame: number): string {
    const position = (frame + runner.slot * 2) % reels.length;
    const running = runner.phase === 'running';
    const left = running ? reels[position]! : '○';
    const right = running ? reels[(position + 3) % reels.length]! : '○';
    return `⟦${left}-${right}⟧`;
}

function attempt(runner: Runner): string {
    if (!runner.test || runner.phase !== 'running' || runner.retry === 0)
        return '';
    return `[${runner.retry + 1}/${runner.test.retries + 1}]`;
}

function paintCounters(text: string, paint: Paint): string {
    return text
        .split(/((?:PASS|FAIL|FLAKY|SKIP|RETRIES) \d+)/)
        .map((part) =>
            paint(part, counterTones[part.split(' ')[0]!] ?? 'muted'),
        )
        .join('');
}

function tone(phase: Phase): Tone {
    if (phase === 'running') return 'teal';
    if (phase === 'idle') return 'muted';
    if (phase === 'retry') return 'amber';
    return 'muted';
}

function lane(
    run: LiveRun,
    runner: Runner,
    width: number,
    frame: number,
    attemptWidth: number,
    paint: Paint,
): string {
    const phase = runner.phase;
    const running = phase === 'running';
    const elapsed = running ? clock(run.elapsedFor(runner)) : '--:--';
    const tape = cassette(runner, frame);
    const label = `${tape} ${elapsed} `;
    const title =
        running && runner.test?.title
            ? singleLine(runner.test.title)
            : phase === 'retry'
              ? 'waiting for retry'
              : 'awaiting test';
    const room = Math.max(
        0,
        width - displayWidth(label) - (attemptWidth ? attemptWidth + 1 : 0),
    );
    const clipped = truncateCells(title, room);
    return (
        paint(tape, tone(phase)) +
        paint(` ${elapsed} `, running ? 'amber' : 'muted') +
        paint(clipped, phase === 'running' ? 'paper' : tone(phase)) +
        (attemptWidth
            ? ' '.repeat(Math.max(0, room - displayWidth(clipped)) + 1) +
              paint(
                  attempt(runner).padStart(attemptWidth),
                  running ? 'amber' : 'muted',
              )
            : '')
    );
}

/** Spinning cassette reels mean executing; finalized outcomes fill the overall bar. */
export function renderWorkerPanel(
    run: LiveRun,
    columns: number,
    terminalRows: number,
    frame: number,
    paint: Paint,
    metrics?: ResourceDisplay | null,
    view?: PanelView,
): string[] {
    const width = Math.max(18, columns - 1);
    const inner = Math.max(1, width - 4);
    const maxRows = Math.max(1, terminalRows - 3);
    const helpRows = view?.enabled && maxRows >= 5 ? 1 : 0;
    const availableRows = maxRows - helpRows;
    const selected = view?.enabled ? view.selected : null;
    const detail: string[] = [];
    const detailBudget = Math.min(6, Math.max(0, availableRows - 4));
    if (
        view?.inspecting &&
        selected !== null &&
        selected !== undefined &&
        detailBudget >= 3
    ) {
        const runner = run.runners[selected];
        const test =
            runner && (runner.phase === 'running' || runner.phase === 'retry')
                ? runner.test
                : undefined;
        const clean = singleLine;
        const title = test ? clean(test.title) : 'awaiting test';
        const source = test?.location;
        const metadata =
            runner?.phase === 'running'
                ? `${runner.retry > 0 && test ? `Attempt ${runner.retry + 1}/${test.retries + 1} · ` : ''}Elapsed ${clock(run.elapsedFor(runner))}`
                : runner?.phase === 'retry'
                  ? 'Waiting for retry'
                  : 'Worker available';
        const titleRows = hangingIndent('', title, inner).trimEnd().split('\n');
        const sourceRows = source && detailBudget >= 4 ? 1 : 0;
        const room = detailBudget - 2 - sourceRows;
        const displayed = titleRows.slice(0, room);
        if (titleRows.length > room && displayed.length)
            displayed[displayed.length - 1] = truncateCells(
                displayed.at(-1)! + ' …',
                inner,
            );
        detail.push(
            ...displayed.map((line) => paint(line, 'paper')),
            paint(truncateCells(metadata, inner), 'amber'),
        );
        if (source && sourceRows) {
            const path = relative(process.cwd(), source.file) || source.file;
            detail.push(
                paint(
                    fitPath(
                        `${clean(path)}:${source.line}:${source.column}`,
                        inner,
                    ),
                    'teal',
                ),
            );
        }
    }
    const detailRows = detail.length ? detail.length + 1 : 0;
    const compact =
        inner < 44 || run.runners.length + 4 + detailRows > availableRows;
    let attemptWidth = run.retries ? attemptHeading.length : 0;
    for (const runner of run.runners) {
        const label = attempt(runner);
        if (label)
            attemptWidth = Math.max(
                attemptWidth,
                attemptHeading.length,
                label.length,
            );
    }
    const rows: string[] = [];
    const edge = (
        left: string,
        label: string,
        right: string,
        accent: Tone,
        decorate?: (value: string) => string,
    ): string => {
        const content = ` ${label} `;
        const text =
            displayWidth(content) <= width - 2
                ? content
                : truncateCells(content, width - 2);
        return (
            paint(left, 'muted') +
            (decorate ? decorate(text) : paint(text, accent)) +
            paint(
                '─'.repeat(Math.max(0, width - 2 - displayWidth(text))) + right,
                'muted',
            )
        );
    };
    const row = (text: string, highlighted = false): string =>
        paint('│', 'muted') +
        paint(highlighted ? '›' : ' ', highlighted ? 'teal' : 'muted') +
        text +
        ' '.repeat(Math.max(0, inner - displayWidth(text))) +
        paint(' │', 'muted');
    const chipWidth = tapeWidth + 2;
    const perRow = Math.max(1, Math.floor(inner / chipWidth));
    const visibleRows = Math.max(0, availableRows - 3 - detailRows);
    const pageSize = Math.max(1, visibleRows * perRow);
    const pages = compact
        ? Math.max(1, Math.ceil(run.runners.length / pageSize))
        : 1;
    const page =
        selected !== null && selected !== undefined
            ? Math.min(pages - 1, Math.floor(selected / pageSize))
            : Math.floor(frame / 16) % pages;
    const pageLabel = pages > 1 ? `  PAGE ${page + 1}/${pages}` : '';
    rows.push(
        edge(
            '╭',
            renderStatusHeader(run, inner, pageLabel, paint, metrics),
            '╮',
            'lavender',
            (text) => text,
        ),
    );
    if (compact) {
        let chipRows = 0;
        for (
            let index = page * pageSize;
            index < run.runners.length && chipRows < visibleRows;
            index += perRow, chipRows++
        ) {
            const chips = run.runners
                .slice(index, index + perRow)
                .map((runner) => {
                    return (
                        (runner.slot === selected ? paint('›', 'teal') : ' ') +
                        paint(
                            cassette(runner, frame).padEnd(chipWidth - 1),
                            tone(runner.phase),
                        )
                    );
                })
                .join('');
            rows.push(row(chips.trimEnd()));
        }
    } else {
        const prefix = `${' '.repeat(tapeWidth)} ${'TIME'.padEnd(5)} `;
        const suffix = attemptWidth
            ? ` ${attemptHeading.padStart(attemptWidth)}`
            : '';
        const titleWidth = Math.max(0, inner - prefix.length - suffix.length);
        const headings = `${prefix}${'CURRENT TEST'.padEnd(titleWidth)}${suffix}`;
        rows.push(row(paint(headings, 'muted')));
        for (const runner of run.runners)
            rows.push(
                row(
                    lane(run, runner, inner, frame, attemptWidth, paint),
                    runner.slot === selected,
                ),
            );
    }
    if (detail.length) {
        rows.push(edge('├', 'DETAILS', '┤', 'lavender'));
        rows.push(...detail.map((line) => row(line)));
    }
    const fraction = run.total ? Math.min(1, run.done / run.total) : 0;
    const progressLabel = `${run.done}/${run.total} DONE ${(fraction * 100).toFixed(1)}%`;
    const barWidth = Math.max(
        0,
        Math.min(22, inner - progressLabel.length - 3),
    );
    const filled = Math.floor(fraction * barWidth);
    const bar = barWidth
        ? `[${paint('━'.repeat(filled), 'teal')}${paint('·'.repeat(barWidth - filled), 'muted')}] `
        : '';
    rows.push(
        row(
            bar +
                paint(
                    truncateCells(
                        progressLabel,
                        Math.max(0, inner - (barWidth ? barWidth + 3 : 0)),
                    ),
                    'paper',
                ),
        ),
    );
    rows.push(
        edge(
            '╰',
            `PASS ${run.counts.passed}  FAIL ${run.counts.failed}  FLAKY ${run.counts.flaky}  SKIP ${run.counts.skipped}  RETRIES ${run.retries}`,
            '╯',
            'muted',
            (text) => paintCounters(text, paint),
        ),
    );
    if (helpRows) {
        const left = view?.held ? '[p] resume display' : '[p] hold display';
        const right = '↑↓ select · enter inspect · esc close';
        const full =
            left +
            ' '.repeat(Math.max(2, width - left.length - right.length)) +
            right;
        rows.push(paint(truncateCells(full, width), 'muted'));
    }
    return rows.slice(0, Math.max(1, maxRows));
}
