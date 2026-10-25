import { stripVTControlCharacters } from 'node:util';

export function singleLine(value: string): string {
    return stripVTControlCharacters(value)
        .replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]+/gu, ' ')
        .trim();
}

export function duration(milliseconds: number): string {
    const ms = Math.max(0, milliseconds);
    if (ms < 1_000) return `${Math.round(ms)}ms`;
    const seconds = Math.round(ms / 1_000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds % 60}s`;
}

export function plainText(value: string): string {
    return stripVTControlCharacters(value)
        .replace(/\r\n?/g, '\n')
        .replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu, (char) =>
            char === '\n' || char === '\t' ? char : ' ',
        );
}
