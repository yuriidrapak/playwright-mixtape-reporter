import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const modules = [
    'colors',
    'controls',
    'diagnostics',
    'format',
    'index',
    'layout',
    'metrics',
    'metrics-monitor',
    'options',
    'output-sanitizer',
    'resource-display',
    'status-header',
    'summary',
    'terminal',
    'worker-panel',
    'workers',
];
export const expectedFiles = new Set([
    ...modules.flatMap((name) => [`dist/${name}.js`, `dist/${name}.d.ts`]),
    'package.json',
    'demo.mjs',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'SECURITY.md',
    'docs/usage.md',
]);

// A deliberately restricted reader for this package's small, regular-file-only
// npm tarballs. Reject extensions, links and paths rather than extracting them.
export function readArchive(compressed) {
    assert.ok(
        compressed.length < 500_000,
        'Compressed artifact exceeds budget',
    );
    const tar = gunzipSync(compressed, { maxOutputLength: 1_000_000 });
    const files = new Map();
    let offset = 0;
    let size = 0;
    const text = (header, start, length) =>
        header
            .subarray(start, start + length)
            .toString('utf8')
            .replace(/\0.*$/s, '');
    const octal = (header, start, length) => {
        const value = text(header, start, length).trim();
        assert.match(value, /^[0-7]+$/, 'Unsupported TAR number');
        return Number.parseInt(value, 8);
    };
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every((byte) => byte === 0)) break;
        let checksum = 0;
        for (let i = 0; i < 512; i++)
            checksum += i >= 148 && i < 156 ? 32 : header[i];
        assert.equal(checksum, octal(header, 148, 8), 'Invalid TAR checksum');
        assert.ok(
            header[156] === 0 || header[156] === 48,
            'Only regular files may be published',
        );
        assert.equal(
            text(header, 345, 155),
            '',
            'TAR prefixes are not allowed',
        );
        assert.equal(
            octal(header, 100, 8) & 0o7111,
            0,
            'Executable or privileged file mode',
        );
        const name = text(header, 0, 100);
        assert.ok(name.startsWith('package/'), 'Unexpected TAR root');
        const file = name.slice(8);
        assert.ok(expectedFiles.has(file), `Unexpected package file: ${file}`);
        assert.ok(!files.has(file), `Duplicate package file: ${file}`);
        const length = octal(header, 124, 12);
        size += length;
        assert.ok(
            size < 500_000 && offset + 512 + length <= tar.length,
            'Invalid artifact size',
        );
        files.set(file, tar.subarray(offset + 512, offset + 512 + length));
        offset += 512 + Math.ceil(length / 512) * 512;
    }
    assert.ok(
        tar.length - offset >= 1024 &&
            tar.subarray(offset).every((byte) => byte === 0),
        'Invalid TAR trailer',
    );
    return files;
}

export function validateFiles(files, version) {
    assert.deepEqual(
        new Set(files.keys()),
        expectedFiles,
        'Package contents differ from the reviewed allowlist',
    );
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const [file, buffer] of files) {
        const content = decoder.decode(buffer);
        // High-confidence patterns only. Report the path, never matched credentials.
        assert.ok(
            !/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_|github_pat_|npm_)[A-Za-z0-9_]{30,}|\bAKIA[0-9A-Z]{16}|\bsk-(?:proj-|ant-api)[A-Za-z0-9_-]{30,})/.test(
                content,
            ),
            `Potential credential in ${file}`,
        );
        if (/\.(?:js|mjs|ts)$/.test(file)) {
            assert.ok(
                !/(?:sourceMappingURL|sourceURL)\s*=|["']sourcesContent["']\s*:/.test(
                    content,
                ),
                `Debug source material in ${file}`,
            );
            assert.ok(
                !/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)[^\s"']+/.test(content),
                `Local user path in ${file}`,
            );
        }
    }
    const metadata = JSON.parse(decoder.decode(files.get('package.json')));
    assert.equal(metadata.name, 'playwright-mixtape-reporter');
    assert.equal(metadata.version, version);
    assert.equal(metadata.license, 'MIT');
    for (const field of [
        'dependencies',
        'optionalDependencies',
        'bundledDependencies',
        'bundleDependencies',
        'bin',
    ])
        assert.ok(
            !metadata[field] || Object.keys(metadata[field]).length === 0,
            `Unexpected ${field}`,
        );
    for (const hook of [
        'preinstall',
        'install',
        'postinstall',
        'prepare',
        'prepack',
        'postpack',
        'prepublish',
        'prepublishOnly',
        'publish',
        'postpublish',
    ])
        assert.equal(
            metadata.scripts?.[hook],
            undefined,
            `Unexpected lifecycle hook: ${hook}`,
        );
    return metadata;
}

export async function inspectArtifact(path, version) {
    const bytes = await readFile(path);
    const files = readArchive(bytes);
    validateFiles(files, version);
    return {
        files,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.length,
    };
}
