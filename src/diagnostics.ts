import {
    closeSync,
    openSync,
    mkdirSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, parse, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import type {
    FullResult,
    TestCase,
    TestError,
} from '@playwright/test/reporter';
import { duration, plainText } from './format.ts';
import { OutputSanitizer } from './output-sanitizer.ts';
import type { MixtapeReporterOptions } from './options.ts';

export interface IssueLog {
    path: string;
    traces: number;
    failed: number;
    flaky: number;
    truncated?: boolean;
}

const limitReached = Symbol('diagnostic byte limit');
const truncationNotice =
    '\n[Diagnostics truncated at configured byte limit.]\n';
const redactionLineLimit = 64 * 1024;

/** Stream lines through the optional redactor without retaining whole attempt output. */
class DiagnosticWriter {
    private bytes = 0;
    private pending = '';
    private pendingBytes = 0;
    private oversized = false;
    private readonly descriptor: number;
    private readonly capacity: number;
    private readonly redact: ((text: string) => string) | undefined;

    constructor(
        descriptor: number,
        maximum: number,
        redact?: (text: string) => string,
    ) {
        this.descriptor = descriptor;
        this.capacity = maximum - Buffer.byteLength(truncationNotice);
        this.redact = redact;
    }

    write(value: string): void {
        if (!this.redact) {
            this.raw(value);
            return;
        }
        let offset = 0;
        while (offset < value.length) {
            const newline = value.indexOf('\n', offset);
            const end = newline < 0 ? value.length : newline;
            if (!this.oversized) {
                const fragment = value.slice(offset, end);
                this.pendingBytes += Buffer.byteLength(fragment);
                if (this.pendingBytes > redactionLineLimit) {
                    this.pending = '';
                    this.oversized = true;
                } else this.pending += fragment;
            }
            if (newline < 0) break;
            this.finishLine();
            offset = newline + 1;
        }
    }

    private finishLine(): void {
        let value =
            '[Diagnostic line omitted: exceeds redaction buffer limit.]';
        if (!this.oversized) {
            try {
                const redacted: unknown = this.redact!(this.pending);
                if (typeof redacted !== 'string') {
                    if (redacted instanceof Promise)
                        void redacted.catch(() => {});
                    throw new TypeError();
                }
                value = plainText(redacted);
            } catch {
                // Callback errors may themselves contain the original secret.
                value = '[Diagnostic redaction failed; line omitted.]';
            }
        }
        this.pending = '';
        this.pendingBytes = 0;
        this.oversized = false;
        this.raw(value + '\n');
    }

    private raw(value: string): void {
        const remaining = this.capacity - this.bytes;
        if (Buffer.byteLength(value) <= remaining) {
            writeFileSync(this.descriptor, value, 'utf8');
            this.bytes += Buffer.byteLength(value);
            return;
        }
        const buffer = Buffer.from(value.slice(0, remaining));
        let end = Math.min(remaining, buffer.length);
        // Stop before an incomplete UTF-8 character.
        while (end > 0 && end < buffer.length && (buffer[end]! & 0xc0) === 0x80)
            end--;
        writeFileSync(this.descriptor, buffer.subarray(0, end));
        writeFileSync(this.descriptor, truncationNotice);
        throw limitReached;
    }
}

function isFile(path: string): boolean {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

function quote(path: string): string {
    return process.platform === 'win32'
        ? "'" + path.replaceAll("'", "''") + "'"
        : "'" + path.replaceAll("'", "'\\''") + "'";
}

/** Write once after execution; no filesystem work is performed on animation ticks. */
export function writeIssueLog(
    path: string,
    tests: readonly TestCase[],
    result: FullResult,
    globalErrors: readonly TestError[],
    options: Pick<
        MixtapeReporterOptions,
        | 'includeOutputInDiagnostics'
        | 'redactDiagnosticText'
        | 'maxDiagnosticBytes'
    > = {},
): IssueLog {
    const selected = tests.filter((test) => {
        const last = test.results.at(-1);
        return (
            last &&
            last.status !== 'interrupted' &&
            (test.outcome() === 'unexpected' || test.outcome() === 'flaky')
        );
    });
    const failed = selected.filter(
        (test) => test.outcome() === 'unexpected',
    ).length;
    const flaky = selected.length - failed;
    const traces = new Set<string>();
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, 'wx', 0o600);
    const writer = new DiagnosticWriter(
        descriptor,
        options.maxDiagnosticBytes ?? 10 * 1024 * 1024,
        options.redactDiagnosticText,
    );
    let truncated = false;
    const lines = {
        push: (...values: string[]): void => {
            for (const value of values) writer.write(value + '\n');
        },
    };
    try {
        lines.push(
            'PLAYWRIGHT MIXTAPE REPORTER / FAILED AND FLAKY TESTS',
            '='.repeat(72),
            `Started: ${result.startTime.toISOString()}`,
            `Run status: ${result.status}`,
            `Duration: ${duration(result.duration)}`,
            `Selected tests: ${tests.length} | failed: ${failed} | flaky: ${flaky}`,
            '',
        );
        for (const [index, test] of selected.entries()) {
            const project = test.parent.project()?.name;
            lines.push(
                `${test.outcome() === 'flaky' ? 'FLAKY' : 'FAILED'} ${index + 1}: ${plainText(test.title)}`,
                `Project: ${plainText(project || '(unnamed)')}`,
                `Suite: ${test.titlePath().map(plainText).filter(Boolean).join(' > ')}`,
                `Source: ${plainText(test.location.file)}:${test.location.line}:${test.location.column}`,
                `Expected status: ${test.expectedStatus}`,
            );
            for (const attempt of test.results) {
                lines.push(
                    '',
                    `  Attempt ${attempt.retry + 1}/${test.retries + 1} | ${attempt.status} | ${duration(attempt.duration)}`,
                );
                const errors = attempt.errors ?? [];
                if (errors.length) {
                    for (const error of errors)
                        lines.push(
                            '  Error:',
                            plainText(
                                error.stack ??
                                    error.message ??
                                    error.value ??
                                    'Unknown error',
                            ),
                        );
                } else if (attempt.status !== test.expectedStatus) {
                    lines.push(
                        `  Expected ${test.expectedStatus}, received ${attempt.status}.`,
                    );
                }
                for (const channel of ['stdout', 'stderr'] as const) {
                    if (options.includeOutputInDiagnostics === false) continue;
                    const chunks = attempt[channel] ?? [];
                    if (chunks.length) {
                        lines.push(`  ${channel}:`);
                        const filter = new OutputSanitizer();
                        for (const chunk of chunks)
                            writer.write(filter.write(chunk));
                        writer.write(filter.end());
                        lines.push('');
                    }
                }
                let hasTrace = false;
                for (const [attachmentIndex, attachment] of (
                    attempt.attachments ?? []
                ).entries()) {
                    const trace =
                        attachment.name === 'trace' ||
                        /(?:^|[/\\])trace\.zip$/i.test(attachment.path ?? '');
                    let file = attachment.path
                        ? resolve(attachment.path)
                        : undefined;
                    if (trace && !file && attachment.body) {
                        const folder = join(
                            dirname(path),
                            `${parse(path).name}-traces`,
                        );
                        mkdirSync(folder, { recursive: true, mode: 0o700 });
                        file = join(
                            folder,
                            `test-${index + 1}-attempt-${attempt.retry + 1}-${attachmentIndex + 1}.zip`,
                        );
                        const traceTemporary = `${file}.${randomUUID()}.tmp`;
                        try {
                            writeFileSync(traceTemporary, attachment.body, {
                                flag: 'wx',
                                mode: 0o600,
                            });
                            renameSync(traceTemporary, file);
                        } finally {
                            rmSync(traceTemporary, { force: true });
                        }
                    }
                    if (trace) hasTrace = true;
                    if (file) {
                        const available = isFile(file);
                        lines.push(
                            `  ${trace ? 'Trace' : 'Attachment'}: ${plainText(attachment.name)}${available ? '' : ' (file unavailable)'}`,
                            `    ${plainText(file)}`,
                            `    ${pathToFileURL(file).href}`,
                        );
                        if (trace && available) {
                            traces.add(file);
                            lines.push(
                                `    Open: npx playwright show-trace ${quote(plainText(file))}`,
                                `    From log directory: npx playwright show-trace ${quote(plainText(relative(dirname(path), file)))}`,
                            );
                        }
                    } else {
                        lines.push(
                            `  ${trace ? 'Trace' : 'Attachment'}: ${plainText(attachment.name)} (in memory${attachment.body ? `, ${attachment.body.length} bytes` : ''})`,
                        );
                    }
                }
                if (!hasTrace)
                    lines.push('  Trace: not recorded for this attempt.');
            }
            lines.push('', '-'.repeat(72), '');
        }
        if (!selected.length) lines.push('No failed or flaky tests.', '');
        if (globalErrors.length) {
            lines.push(`GLOBAL ERRORS (${globalErrors.length})`, '');
            for (const error of globalErrors)
                lines.push(
                    plainText(
                        error.stack ??
                            error.message ??
                            error.value ??
                            'Unknown error',
                    ),
                    '',
                );
        }
        lines.push(`Available traces: ${traces.size}`, '');
    } catch (error) {
        if (error === limitReached) truncated = true;
        else {
            closeSync(descriptor);
            rmSync(temporary, { force: true });
            throw error;
        }
    }
    closeSync(descriptor);
    try {
        renameSync(temporary, path);
    } finally {
        rmSync(temporary, { force: true });
    }
    return { path, traces: traces.size, failed, flaky, truncated };
}
