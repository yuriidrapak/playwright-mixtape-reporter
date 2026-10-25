import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const packageDir = fileURLToPath(new URL('../', import.meta.url));
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
// Playwright resolves configured reporter names from node_modules; a source checkout
// is not installed there. The package smoke check separately tests the public name.
export const reporter = fileURLToPath(
    new URL('../dist/index.js', import.meta.url),
).replaceAll('\\', '/');

export async function ttyCommand(
    args: string[],
    cwd: string,
    envOverrides: NodeJS.ProcessEnv,
): Promise<{ code: number | null; output: string }> {
    const quote = (value: string): string =>
        "'" + value.replaceAll("'", "'\\''") + "'";
    const argv = [process.execPath, cli, ...args];
    const scriptArgs =
        process.platform === 'darwin'
            ? ['-q', '/dev/null', ...argv]
            : ['-q', '-e', '-c', argv.map(quote).join(' '), '/dev/null'];
    const child = spawn('script', scriptArgs, {
        cwd,
        env: {
            ...process.env,
            CI: '',
            TERM: 'xterm-256color',
            ...envOverrides,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
        output += String(chunk);
    });
    return new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, output }));
    });
}

export async function command(
    args: string[],
    cwd: string,
    envOverrides: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; output: string }> {
    const child = spawn(process.execPath, [cli, ...args], {
        cwd,
        env: {
            ...process.env,
            CI: '1',
            FORCE_COLOR: '0',
            NO_COLOR: '1',
            PLAYWRIGHT_HTML_OPEN: 'never',
            ...envOverrides,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
        output += String(chunk);
    });
    return new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, output }));
    });
}
