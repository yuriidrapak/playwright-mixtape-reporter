import { displayWidth, fitPath, hangingIndent } from './layout.ts';
import { basename } from 'node:path';
import type { Status } from './colors.ts';
import type { Terminal } from './terminal.ts';
import type { ResolvedOptions } from './options.ts';
import type { IssueLog } from './diagnostics.ts';
import { singleLine } from './format.ts';

export interface Summary {
    counts: Record<Status, number>;
    total: number;
    runtime: string;
    status: string;
    globalErrors: number;
    log?: IssueLog;
    logError?: string;
}

export function renderSummary(
    data: Summary,
    options: ResolvedOptions,
    terminal: Terminal,
    columns: number,
): string {
    const fields = (['passed', 'failed', 'flaky', 'skipped'] as const).map(
        (status) =>
            `${terminal.mark(status, options.theme === 'cassette' ? 'ascii' : options.symbols)} ${terminal.statusText(`${status}: ${data.counts[status]}`, status)}`,
    );
    for (const status of ['interrupted', 'notRun'] as const)
        if (data.counts[status])
            fields.push(
                `${terminal.mark(status, options.theme === 'cassette' ? 'ascii' : options.symbols)} ${terminal.statusText(`${status === 'notRun' ? 'not run' : status}: ${data.counts[status]}`, status)}`,
            );
    const rate = data.total
        ? ((data.counts.passed / data.total) * 100).toFixed(1)
        : '0.0';
    const passRate = `Pass rate: ${data.counts.passed}/${data.total} (${rate}%)`;
    const state =
        data.status === 'passed'
            ? 'passed'
            : data.status === 'interrupted'
              ? 'interrupted'
              : 'failed';
    const logLabel = 'Failed and flaky tests';
    const logPath = data.log ? singleLine(data.log.path) : '';
    const runStatus = data.status === 'timedout' ? 'timed out' : data.status;
    const traceLabel = data.log?.traces
        ? `Traces: ${data.log.traces} available`
        : 'Traces: none recorded';
    if (options.theme === 'compact') {
        const chart = options.symbols === 'ascii' ? '' : '📊 ';
        return (
            `\n${terminal.rule()}\nSummary:\n\n${fields.join(' | ')}\n\n${chart}${passRate} | Duration: ${data.runtime}\n` +
            (data.status === 'passed' ? '' : `Run status: ${runStatus}\n`) +
            (data.globalErrors ? `Global errors: ${data.globalErrors}\n` : '') +
            (data.log
                ? `${terminal.fileLink(logLabel, data.log.path)}: ${logPath}\n${traceLabel}\n`
                : '') +
            (data.log?.truncated
                ? 'Issue log truncated at configured byte limit.\n'
                : '') +
            (data.logError ? `Issue log unavailable: ${data.logError}\n` : '') +
            terminal.rule() +
            '\n'
        );
    }
    const mono = options.symbols === 'ascii';
    const width = Math.max(12, Math.min(96, columns - 1));
    const inner = width - 4;
    const horizontal = mono ? '-' : '─';
    const side = terminal.paint(mono ? '|' : '│', 'muted');
    const lines: string[] = [''];
    const edge = (left: string, title: string, right: string): void => {
        title = title.slice(0, Math.max(0, width - 5));
        lines.push(
            terminal.paint(left + horizontal, 'muted') +
                terminal.paint(` ${title} `, 'lavender') +
                terminal.paint(
                    horizontal.repeat(
                        Math.max(0, width - displayWidth(title) - 5),
                    ) + right,
                    'muted',
                ),
        );
    };
    const row = (value = '', file?: string): void => {
        for (const line of hangingIndent('', value, inner)
            .slice(0, -1)
            .split('\n')) {
            const text = file
                ? terminal.fileLink(terminal.paint(line, 'teal'), file)
                : line;
            lines.push(
                `${side} ${text}${' '.repeat(Math.max(0, inner - displayWidth(line)))} ${side}`,
            );
        }
    };
    edge(mono ? '+' : '╭', 'FINAL MIX', mono ? '+' : '╮');
    row(terminal.statusText(`RUN ${runStatus.toUpperCase()}`, state));
    row();
    row(fields.join('   '));
    row();
    const barWidth = Math.max(
        4,
        Math.min(30, inner - displayWidth(passRate) - 3),
    );
    const filled = data.total
        ? Math.floor((barWidth * data.counts.passed) / data.total)
        : 0;
    const bar =
        '[' +
        terminal.statusText((mono ? '=' : '━').repeat(filled), 'passed') +
        terminal.paint(
            '·'.repeat(barWidth - filled).replaceAll('·', mono ? '.' : '·'),
            'muted',
        ) +
        ']';
    row(bar + ' ' + terminal.paint(passRate, 'paper'));
    row(terminal.paint(`Duration: ${data.runtime}`, 'cyan'));
    if (data.globalErrors)
        row(
            terminal.statusText(
                `Global errors: ${data.globalErrors}`,
                'failed',
            ),
        );
    if (data.log || data.logError) {
        edge(mono ? '+' : '├', 'DIAGNOSTICS', mono ? '+' : '┤');
        if (data.log) {
            row(logLabel);
            row(traceLabel);
            if (data.log.truncated)
                row('Issue log truncated at configured byte limit.');
            row(
                `Open ${fitPath(basename(logPath), Math.max(1, inner - 5), mono)}`,
                data.log.path,
            );
            row(fitPath(logPath, inner, mono), data.log.path);
        }
        if (data.logError)
            row(
                terminal.statusText(
                    `Issue log unavailable: ${data.logError}`,
                    'failed',
                ),
            );
    }
    lines.push(
        terminal.paint(
            (mono ? '+' : '╰') +
                horizontal.repeat(width - 2) +
                (mono ? '+' : '╯'),
            'muted',
        ),
    );
    return lines.join('\n') + '\n';
}
