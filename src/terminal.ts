import { stripVTControlCharacters } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { ResolvedOptions } from './options.ts';
import { displayWidth, hangingIndent, linePatch } from './layout.ts';

import { palette, statusTone, type Status, type Tone } from './colors.ts';
import { LiveRun, type WorkerTest, type WorkerResult } from './workers.ts';
import { renderWorkerPanel } from './worker-panel.ts';
import { MetricsMonitor } from './metrics-monitor.ts';
import { ResourceAnimation } from './resource-display.ts';
import { TerminalControls } from './controls.ts';
import { OutputSanitizer } from './output-sanitizer.ts';
import { singleLine } from './format.ts';

export type { Status } from './colors.ts';
export { singleLine } from './format.ts';

const emoji: Record<Status, string> = {
    passed: '✅',
    failed: '❌',
    flaky: '🟡',
    // Default emoji presentation avoids variation-selector width differences.
    skipped: '⏩',
    interrupted: '⏹️',
    notRun: '➖',
};
const ascii: Record<Status, string> = {
    passed: '[PASS]',
    failed: '[FAIL]',
    flaky: '[FLAKY]',
    skipped: '[SKIP]',
    interrupted: '[STOP]',
    notRun: '[NOT RUN]',
};
const statusColor: Record<Status, number> = {
    passed: 32,
    failed: 31,
    flaky: 33,
    skipped: 36,
    interrupted: 33,
    notRun: 90,
};

/** One timer and a transient worker panel; completed results stay in scrollback. */
export class Terminal {
    private readonly options: ResolvedOptions;
    private readonly outputFilters = new Map<
        NodeJS.WriteStream,
        OutputSanitizer
    >();
    private timer: ReturnType<typeof setInterval> | undefined;
    private liveRows = 0;
    private previousFrame: string[] = [];
    private frameColumns = 0;
    private frameRows = 0;
    private cursorHidden = false;
    private atLineStart = true;
    private frame = 0;
    private readonly run = new LiveRun();
    private readonly metrics = new MetricsMonitor();
    private readonly resourceAnimation = new ResourceAnimation();
    private metricsPolledAt = 0;
    private readonly controls = new TerminalControls(
        () => this.run.runners.length,
        () => {
            if (this.atLineStart && !process.stdout.writableNeedDrain)
                this.flush(this.frameSequence());
        },
    );

    constructor(options: ResolvedOptions) {
        this.options = options;
    }

    get joiner(): string {
        return this.options.monochrome ? ' / ' : ' · ';
    }

    get arrow(): string {
        return this.options.monochrome ? ' > ' : ' › ';
    }

    paint(value: string, tone: Tone): string {
        if (!value) return value;
        return this.options.colors && this.options.theme === 'cassette'
            ? `\u001b[${palette[tone]}m${value}\u001b[0m`
            : value;
    }

    mark(status: Status, symbols = this.options.symbols): string {
        const symbol = (symbols === 'ascii' ? ascii : emoji)[status];
        return this.statusText(symbol, status);
    }

    statusText(value: string, status: Status): string {
        return this.options.colors
            ? `\u001b[${this.options.theme === 'cassette' ? palette[statusTone[status]] : statusColor[status]}m${value}\u001b[0m`
            : value;
    }

    fileLink(value: string, path: string): string {
        if (
            !this.options.colors ||
            !process.stdout.isTTY ||
            process.env.TERM === 'dumb'
        )
            return value;
        return `\u001b]8;;${pathToFileURL(path).href}\u001b\\${value}\u001b]8;;\u001b\\`;
    }

    writeTest(
        status: Status,
        body: string,
        details?: { duration: string; detail?: string },
    ): void {
        const icon = this.mark(status);
        const iconColumn = this.options.symbols === 'ascii' ? 9 : 2;
        const padding = ' '.repeat(
            Math.max(0, iconColumn - displayWidth(icon)),
        );
        const prefix = `  ${icon}${padding} `;
        let text = this.statusText(stripVTControlCharacters(body), status);
        if (details) {
            const elapsed = `(${stripVTControlCharacters(details.duration)})`;
            const timing = this.options.colors
                ? `\u001b[${this.options.theme === 'cassette' ? palette.cyan : 96}m${elapsed}\u001b[0m`
                : elapsed;
            text += ` ${timing}`;
            if (details.detail)
                text += this.statusText(
                    stripVTControlCharacters(details.detail),
                    status,
                );
        }
        this.write(hangingIndent(prefix, text, process.stdout.columns || 80));
    }

    rule(label?: string): string {
        const glyph = this.options.symbols === 'ascii' ? '-' : '─';
        if (this.options.theme === 'compact') return glyph.repeat(80);
        const width = Math.max(
            24,
            Math.min(76, (process.stdout.columns || 80) - 2),
        );
        const text = label ? `${glyph.repeat(2)} ${label} ` : '';
        return this.paint(
            text + glyph.repeat(Math.max(0, width - text.length)),
            'muted',
        );
    }

    header(
        total: number,
        workers: number,
        shard?: { current: number; total: number } | null,
    ): void {
        this.run.reset(total, workers);
        const title = singleLine(this.options.title);
        const running = `Running ${total} ${total === 1 ? 'test' : 'tests'} on ${workers} ${workers === 1 ? 'worker' : 'workers'}${shard ? `${this.joiner}shard ${shard.current}/${shard.total}` : ''}`;
        if (this.options.theme === 'compact') {
            const icons = this.options.symbols !== 'ascii';
            this.write(
                `\n${icons ? '📋 ' : ''}${title}\n${icons ? '🧪 ' : ''}${running}\n${this.rule()}\nRun:\n`,
            );
            return;
        }

        this.write(
            `\n${this.paint(title, 'paper')}\n${this.paint(running, 'muted')}\n${this.rule()}\nRun:\n`,
        );
    }

    start(): void {
        if (!this.options.animations || this.timer) return;
        if (this.options.showMetrics) this.metrics.start();
        if (this.options.interactive) this.controls.start();
        this.cursorHidden = true;
        process.stdout.write('\u001b[?25l');
        this.timer = setInterval(() => this.draw(), 120);
        this.timer.unref?.();
        this.draw();
    }

    beginTest(test: WorkerTest, result: WorkerResult): void {
        if (!this.options.animations) return;
        this.run.begin(test, result);
    }

    endTest(test: WorkerTest, result: WorkerResult, status: Status): void {
        if (this.options.animations) this.run.end(test, result, status);
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        this.controls.stop();
        this.outputFilters.clear();
        this.metrics.stop();
        this.resourceAnimation.reset();
        this.run.release();
        const clear = this.clearSequence();
        this.flush(clear + (this.cursorHidden ? '\u001b[?25h' : ''));
        this.cursorHidden = false;
    }

    write(block: string): void {
        if (this.insertAbovePanel(block)) return;
        let output = `${this.clearSequence()}${this.atLineStart ? '' : '\n'}${block}`;
        this.atLineStart = block.endsWith('\n');
        // Large output, partial logs and resize recovery still commit in one frame.
        if (this.timer && this.atLineStart) output += this.frameSequence();
        this.flush(output);
    }

    forward(chunk: string | Buffer, stream: NodeJS.WriteStream): void {
        if (!this.options.showLogs) return;
        let filter = this.outputFilters.get(stream);
        if (!filter) {
            filter = new OutputSanitizer(this.options.colors);
            this.outputFilters.set(stream, filter);
        }
        const value = filter.write(chunk);
        if (!value) return;
        if (
            stream === process.stdout &&
            this.atLineStart &&
            value.toString().endsWith('\n')
        ) {
            this.write(value.toString());
            return;
        }
        const clear = this.clearSequence();
        if (clear) this.flush(clear);
        stream.write(value);
        if (value.length) this.atLineStart = value.toString().endsWith('\n');
        if (this.timer && this.atLineStart) this.flush(this.frameSequence());
    }

    private clearSequence(): string {
        if (!this.liveRows) return '';
        const columns = process.stdout.columns || 80;
        // A narrower viewport can reflow each previous row onto several lines.
        // Frames park the cursor at column zero of the last row, so only rows
        // above it contribute to the distance back to the panel's origin.
        const distance = this.previousFrame
            .slice(0, -1)
            .reduce(
                (height, line) =>
                    height +
                    Math.max(1, Math.ceil(displayWidth(line) / columns)),
                0,
            );
        const up = distance ? `\u001b[${distance}A` : '';
        this.liveRows = 0;
        this.previousFrame = [];
        this.frameColumns = 0;
        this.frameRows = 0;
        return `\r${up}\u001b[0J`;
    }

    private flush(block: string): void {
        if (!block) return;
        // Supporting terminals present the complete mutation together; others ignore the mode.
        process.stdout.write(
            this.options.animations
                ? `\u001b[?2026h${block}\u001b[?2026l`
                : block,
        );
    }

    private insertAbovePanel(block: string): boolean {
        const columns = process.stdout.columns || 80;
        const terminalRows = process.stdout.rows || 24;
        if (
            !this.liveRows ||
            !this.atLineStart ||
            !block.endsWith('\n') ||
            this.frameColumns !== columns ||
            this.frameRows !== terminalRows
        )
            return false;
        const room = terminalRows - this.liveRows;
        const batches: Array<{ text: string; height: number }> = [];
        let text = '';
        let height = 0;
        for (const line of block.slice(0, -1).split('\n')) {
            const size = Math.max(1, Math.ceil(displayWidth(line) / columns));
            if (size > room) return false;
            if (height + size > room) {
                batches.push({ text, height });
                text = '';
                height = 0;
            }
            text += line.replace(/\r$/, '') + '\r\n';
            height += size;
        }
        if (height) batches.push({ text, height });
        let output = '';
        for (const batch of batches) {
            // Make space at the bottom (normal scrollback), then move the panel down
            // into it with IL. Its existing cells are retained rather than repainted.
            output +=
                '\r' +
                '\n'.repeat(batch.height) +
                `\u001b[${this.liveRows - 1 + batch.height}A\r` +
                `\u001b[${batch.height}L` +
                batch.text;
            if (this.liveRows > 1) output += `\u001b[${this.liveRows - 1}B`;
        }
        this.flush(output + this.frameSequence());
        return true;
    }

    private frameSequence(): string {
        const columns = process.stdout.columns || 80;
        const terminalRows = process.stdout.rows || 24;
        const rows = renderWorkerPanel(
            this.run,
            columns,
            terminalRows,
            this.frame,
            (value, tone) => this.paint(value, tone),
            this.options.showMetrics
                ? this.resourceAnimation.next(
                      this.metrics.current(
                          this.run.runners
                              .filter((runner) => runner.phase === 'running')
                              .map((runner) => runner.workerIndex),
                      ),
                  )
                : undefined,
            this.controls.view,
        );
        let block = '';
        if (
            this.liveRows === rows.length &&
            this.frameColumns === columns &&
            this.frameRows === terminalRows
        ) {
            let cursorRow = rows.length - 1;
            for (let index = 0; index < rows.length; index++) {
                const patch = linePatch(
                    this.previousFrame[index]!,
                    rows[index]!,
                );
                if (!patch) continue;
                const distance = index - cursorRow;
                if (distance)
                    block += `\u001b[${Math.abs(distance)}${distance < 0 ? 'A' : 'B'}`;
                block += `\u001b[${patch.column + 1}G${patch.text}`;
                cursorRow = index;
            }
            const down = rows.length - 1 - cursorRow;
            if (down) block += `\u001b[${down}B`;
        } else {
            block = this.clearSequence() + rows.join('\r\n');
        }
        this.liveRows = rows.length;
        this.previousFrame = rows;
        this.frameColumns = columns;
        this.frameRows = terminalRows;
        return block ? block + '\r' : '';
    }

    private draw(): void {
        if (
            !this.atLineStart ||
            process.stdout.destroyed ||
            process.stdout.writableNeedDrain
        )
            return;
        if (
            this.options.showMetrics &&
            performance.now() - this.metricsPolledAt >= 1000
        ) {
            this.metricsPolledAt = performance.now();
            void this.metrics.poll();
        }
        if (this.controls.view.held) return;
        this.frame++;
        this.flush(this.frameSequence());
    }
}
