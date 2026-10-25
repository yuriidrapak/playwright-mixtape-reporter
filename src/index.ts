import { dirname, parse, relative, resolve } from 'node:path';
import type {
    FullConfig,
    FullResult,
    Reporter,
    Suite,
    TestCase,
    TestError,
    TestResult,
} from '@playwright/test/reporter';

import {
    resolveOptions,
    type MixtapeReporterOptions,
    type ResolvedOptions,
} from './options.ts';
import { Terminal, singleLine, type Status } from './terminal.ts';
import { duration, plainText } from './format.ts';
import { writeIssueLog, type IssueLog } from './diagnostics.ts';
import { renderSummary } from './summary.ts';
import { hangingIndent, indentLines } from './layout.ts';

export type { MixtapeReporterOptions } from './options.ts';

/** Compact results and an optional animated cassette deck, using only Node built-ins. */
export default class MixtapeReporter implements Reporter {
    private readonly options: ResolvedOptions;
    private readonly terminal: Terminal;
    private tests: TestCase[] = [];
    private rootDir = '';
    private globalErrors: TestError[] = [];
    private outputFile: string | undefined;

    constructor(options: MixtapeReporterOptions = {}) {
        this.options = resolveOptions(options);
        this.terminal = new Terminal(this.options);
    }

    printsToStdio(): boolean {
        return true;
    }

    onBegin(config: FullConfig, suite: Suite): void {
        this.tests = suite.allTests();
        this.rootDir = config.rootDir;
        this.globalErrors = [];
        this.outputFile = undefined;
        if (this.options.outputFile !== false) {
            const directory = config.configFile
                ? dirname(config.configFile)
                : process.cwd();
            const file = resolve(directory, this.options.outputFile);
            const parts = parse(file);
            this.outputFile = config.shard
                ? resolve(
                      parts.dir,
                      `${parts.name}-shard-${config.shard.current}-of-${config.shard.total}${parts.ext}`,
                  )
                : file;
        }
        this.terminal.header(this.tests.length, config.workers, config.shard);
        this.terminal.start();
    }

    onTestBegin(test: TestCase, result: TestResult): void {
        this.terminal.beginTest(test, result);
    }

    onTestEnd(test: TestCase, result: TestResult): void {
        const expected = result.status === test.expectedStatus;
        let status: Status;
        if (result.status === 'skipped') status = 'skipped';
        else if (result.status === 'interrupted') status = 'interrupted';
        else if (!expected) status = 'failed';
        else status = test.outcome() === 'flaky' ? 'flaky' : 'passed';

        this.terminal.endTest(test, result, status);
        let detail = '';
        if (result.status === 'timedOut')
            detail += `${this.terminal.joiner}timed out`;
        if (result.status === 'failed' && expected)
            detail += `${this.terminal.joiner}expected failure`;
        if (result.status === 'passed' && !expected)
            detail += `${this.terminal.joiner}unexpected pass`;
        if (result.retry > 0) {
            detail += `${this.terminal.joiner}attempt ${result.retry + 1}/${test.retries + 1}`;
        }
        this.terminal.writeTest(status, this.label(test), {
            duration: duration(result.duration),
            detail,
        });
    }

    onStdOut(chunk: string | Buffer): void {
        this.terminal.forward(chunk, process.stdout);
    }

    onStdErr(chunk: string | Buffer): void {
        this.terminal.forward(chunk, process.stderr);
    }

    onError(error: TestError): void {
        this.globalErrors.push(error);
        const message =
            this.options.printFailureDetails === false
                ? singleLine(error.message ?? error.value ?? 'Unknown error')
                : this.errorText(error);
        this.terminal.write(
            `\n${this.terminal.mark('failed')} Global error:\n${message}\n`,
        );
    }

    onEnd(result: FullResult): void {
        this.terminal.stop();
        const counts: Record<Status, number> = {
            passed: 0,
            failed: 0,
            flaky: 0,
            skipped: 0,
            interrupted: 0,
            notRun: 0,
        };
        let printedFailures = false;
        for (const test of this.tests) {
            const last = test.results.at(-1);
            if (!last) {
                counts.notRun++;
                continue;
            }
            if (last.status === 'interrupted') {
                counts.interrupted++;
                continue;
            }
            const outcome = test.outcome();
            if (outcome === 'expected') counts.passed++;
            else if (outcome === 'flaky') counts.flaky++;
            else if (outcome === 'skipped') counts.skipped++;
            else {
                counts.failed++;
                if (this.options.printFailureDetails !== false) {
                    const location = test.location;
                    const file =
                        relative(this.rootDir, location.file) || location.file;
                    const columns = Math.max(
                        24,
                        (process.stdout.columns || 80) - 1,
                    );
                    const prefix = `  ${counts.failed}) `;
                    const indent = ' '.repeat(prefix.length);
                    const errors = last.errors.length
                        ? last.errors
                              .map((error) =>
                                  this.errorText(error, prefix.length),
                              )
                              .join('\n\n')
                        : hangingIndent(
                              indent,
                              `Expected ${test.expectedStatus}, received ${last.status}.`,
                              columns,
                          ).slice(0, -1);
                    const heading = printedFailures ? '\n' : '\nFailures:\n\n';
                    const failureTitle = this.terminal.statusText(
                        singleLine(this.label(test)),
                        'failed',
                    );
                    this.terminal.write(
                        heading +
                            hangingIndent(
                                this.terminal.statusText(prefix, 'failed'),
                                failureTitle,
                                columns,
                            ) +
                            hangingIndent(
                                indent,
                                `${singleLine(file)}:${location.line}:${location.column}`,
                                columns,
                            ) +
                            errors +
                            '\n',
                    );
                    printedFailures = true;
                }
            }
        }

        let log: IssueLog | undefined;
        let logError: string | undefined;
        if (this.outputFile) {
            try {
                log = writeIssueLog(
                    this.outputFile,
                    this.tests,
                    result,
                    this.globalErrors,
                    this.options,
                );
            } catch (error) {
                logError = singleLine(
                    error instanceof Error ? error.message : String(error),
                );
            }
        }
        this.terminal.write(
            renderSummary(
                {
                    counts,
                    total: this.tests.length,
                    runtime: duration(result.duration),
                    status: result.status,
                    globalErrors: this.globalErrors.length,
                    ...(log ? { log } : {}),
                    ...(logError ? { logError } : {}),
                },
                this.options,
                this.terminal,
                process.stdout.columns || 80,
            ),
        );
    }

    onExit(): Promise<void> {
        this.terminal.stop();
        return Promise.resolve();
    }

    private label(test: TestCase): string {
        const project = test.parent.project()?.name;
        const title = this.options.includeSuiteTitles
            ? test.titlePath().slice(3).join(this.terminal.arrow)
            : test.title;
        const prefix = project
            ? `${this.terminal.paint(`[${singleLine(project)}]`, 'teal')}${this.terminal.arrow}`
            : '';
        return `${prefix}${singleLine(title)}`;
    }

    private errorText(error: TestError, indent = 5): string {
        const value = plainText(
            error.stack ?? error.message ?? error.value ?? 'Unknown error',
        );
        return indentLines(
            value,
            indent,
            Math.max(24, (process.stdout.columns || 80) - 1),
        );
    }
}
