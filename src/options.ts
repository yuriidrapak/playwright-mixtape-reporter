export interface MixtapeReporterOptions {
    /** Heading above the run. Default: Playwright Mixtape Reporter. */
    title?: string;
    /** Auto-detect, force ANSI color, or use plain black-and-white text. Default: auto. */
    colorMode?: 'auto' | 'color' | 'bw';
    /** Retro ANSI colors with a compact live parallel-runner panel, or the original static layout. Default: cassette. */
    theme?: 'cassette' | 'compact';
    /** Show live parallel runners on color-capable interactive terminals. Default: true. */
    animations?: boolean;
    /** Keyboard runner inspection and display hold on an unclaimed input TTY. Default: true. */
    interactive?: boolean;
    /** Forward test stdout/stderr, including console.log/error. Default: false. */
    showLogs?: boolean;
    /** Show smoothed total system CPU and combined worker network meters in the live deck. Default: false. */
    showMetrics?: boolean;
    /** Emoji or text test markers; framed summary badges and bw mode use ASCII. Default: emoji. */
    symbols?: 'emoji' | 'ascii';
    /** Include describe titles before each test title. Default: false. */
    includeSuiteTitles?: boolean;
    /** Print final failures with source locations and errors. Default: true. */
    printFailureDetails?: boolean;
    /** Failed/flaky log relative to the config directory. Default: test-results/mixtape-reporter/issues.log; false disables it. */
    outputFile?: string | false;
    /** Include captured stdout/stderr in the issue log. Default: true; independent of showLogs. */
    includeOutputInDiagnostics?: boolean;
    /** Transform each plain-text issue-log line before writing. Does not redact terminal output or trace contents. */
    redactDiagnosticText?: (text: string) => string;
    /** Maximum issue-log UTF-8 bytes, including a truncation notice; at least 1024. Default: 10 MiB. Excludes traces. */
    maxDiagnosticBytes?: number;
    /** Compatibility alias for forcing ANSI color on/off; prefer colorMode. */
    colors?: boolean;
    /** Compatibility alias for showLogs. */
    printOutput?: boolean;
}

export interface ResolvedOptions {
    title: string;
    theme: 'cassette' | 'compact';
    colors: boolean;
    monochrome: boolean;
    animations: boolean;
    interactive: boolean;
    showLogs: boolean;
    showMetrics: boolean;
    symbols: 'emoji' | 'ascii';
    includeSuiteTitles: boolean;
    printFailureDetails: boolean;
    outputFile: string | false;
    includeOutputInDiagnostics: boolean;
    redactDiagnosticText?: (text: string) => string;
    maxDiagnosticBytes: number;
}

function choice<T extends string>(
    value: string,
    choices: readonly T[],
    name: string,
): T {
    for (const candidate of choices) if (value === candidate) return candidate;
    throw new Error(`${name} must be one of: ${choices.join(', ')}`);
}

function booleanEnv(name: string): boolean | undefined {
    const value = process.env[name];
    if (value === undefined || value === '') return undefined;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    throw new Error(`${name} must be true, false, 1, or 0`);
}

export function resolveOptions(
    options: MixtapeReporterOptions,
): ResolvedOptions {
    if (!options || typeof options !== 'object' || Array.isArray(options))
        throw new TypeError('Reporter options must be an object');
    for (const key of [
        'animations',
        'interactive',
        'showLogs',
        'showMetrics',
        'includeSuiteTitles',
        'printFailureDetails',
        'colors',
        'printOutput',
        'includeOutputInDiagnostics',
    ] as const) {
        if (options[key] !== undefined && typeof options[key] !== 'boolean')
            throw new TypeError(`${key} must be a boolean`);
    }
    if (options.title !== undefined && typeof options.title !== 'string')
        throw new TypeError('title must be a string');
    if (
        options.redactDiagnosticText !== undefined &&
        typeof options.redactDiagnosticText !== 'function'
    )
        throw new TypeError('redactDiagnosticText must be a function');
    if (
        options.maxDiagnosticBytes !== undefined &&
        (!Number.isSafeInteger(options.maxDiagnosticBytes) ||
            options.maxDiagnosticBytes < 1024)
    )
        throw new TypeError(
            'maxDiagnosticBytes must be a safe integer of at least 1024',
        );
    if (
        options.outputFile !== undefined &&
        options.outputFile !== false &&
        (typeof options.outputFile !== 'string' ||
            !options.outputFile.trim() ||
            options.outputFile.includes('\0'))
    )
        throw new TypeError('outputFile must be a nonempty path or false');
    const symbols = choice(
        options.symbols ?? 'emoji',
        ['emoji', 'ascii'],
        'symbols',
    );
    const mode = choice(
        options.colorMode ??
            process.env.PLAYWRIGHT_MIXTAPE_COLOR_MODE ??
            'auto',
        ['auto', 'color', 'bw'],
        'colorMode / PLAYWRIGHT_MIXTAPE_COLOR_MODE',
    );
    const theme = choice(
        options.theme ?? process.env.PLAYWRIGHT_MIXTAPE_THEME ?? 'cassette',
        ['cassette', 'compact'],
        'theme / PLAYWRIGHT_MIXTAPE_THEME',
    );
    const monochrome = mode === 'bw';
    const colors = monochrome
        ? false
        : mode === 'color'
          ? true
          : (options.colors ??
            (!process.env.NO_COLOR &&
                process.env.FORCE_COLOR !== '0' &&
                (Boolean(process.env.FORCE_COLOR) ||
                    (process.env.TERM !== 'dumb' &&
                        Boolean(process.stdout.isTTY)))));
    const inCI = Boolean(
        process.env.CI && process.env.CI !== '0' && process.env.CI !== 'false',
    );
    const requestedAnimation =
        options.animations ??
        booleanEnv('PLAYWRIGHT_MIXTAPE_ANIMATIONS') ??
        true;
    return {
        title: options.title ?? 'Playwright Mixtape Reporter',
        theme,
        colors,
        monochrome,
        animations:
            requestedAnimation &&
            theme === 'cassette' &&
            colors &&
            Boolean(process.stdout.isTTY) &&
            !inCI &&
            process.env.TERM !== 'dumb',
        showLogs:
            options.showLogs ??
            options.printOutput ??
            booleanEnv('PLAYWRIGHT_MIXTAPE_SHOW_LOGS') ??
            false,
        interactive:
            options.interactive ??
            booleanEnv('PLAYWRIGHT_MIXTAPE_INTERACTIVE') ??
            true,
        showMetrics:
            options.showMetrics ??
            booleanEnv('PLAYWRIGHT_MIXTAPE_SHOW_METRICS') ??
            false,
        symbols: monochrome ? 'ascii' : symbols,
        includeSuiteTitles: options.includeSuiteTitles ?? false,
        printFailureDetails: options.printFailureDetails ?? true,
        outputFile:
            options.outputFile ?? 'test-results/mixtape-reporter/issues.log',
        includeOutputInDiagnostics: options.includeOutputInDiagnostics ?? true,
        ...(options.redactDiagnosticText
            ? { redactDiagnosticText: options.redactDiagnosticText }
            : {}),
        maxDiagnosticBytes: options.maxDiagnosticBytes ?? 10 * 1024 * 1024,
    };
}
