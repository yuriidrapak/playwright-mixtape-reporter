import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspectArtifact } from './artifact-policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
assert.ok(process.env.npm_execpath, 'Run npm run pack');
const [packed] = JSON.parse(
    execFileSync(
        process.execPath,
        [process.env.npm_execpath, 'pack', '--json', '--ignore-scripts'],
        { cwd: root, encoding: 'utf8' },
    ),
);
const artifact = await inspectArtifact(
    new URL(`../${packed.filename}`, import.meta.url),
    metadata.version,
);
if (process.env.GITHUB_OUTPUT)
    await appendFile(
        process.env.GITHUB_OUTPUT,
        `sha256=${artifact.sha256}\nfilename=${packed.filename}\n`,
    );
console.log(
    `Verified ${packed.filename}: ${artifact.files.size} files, ${artifact.size} bytes, SHA-256 ${artifact.sha256}`,
);
