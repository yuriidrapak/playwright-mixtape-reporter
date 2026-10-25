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

export interface IssueLog {
    path: string;
    traces: number;
    failed: number;
    flaky: number;
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
    const lines = {
        push: (...values: string[]): void => {
            writeFileSync(descriptor, values.join('\n') + '\n', 'utf8');
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
                    const chunks = attempt[channel] ?? [];
                    if (chunks.length) {
                        lines.push(`  ${channel}:`);
                        const filter = new OutputSanitizer();
                        for (const chunk of chunks)
                            writeFileSync(
                                descriptor,
                                filter.write(chunk),
                                'utf8',
                            );
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
        closeSync(descriptor);
        rmSync(temporary, { force: true });
        throw error;
    }
    closeSync(descriptor);
    try {
        renameSync(temporary, path);
    } finally {
        rmSync(temporary, { force: true });
    }
    return { path, traces: traces.size, failed, flaky };
}
