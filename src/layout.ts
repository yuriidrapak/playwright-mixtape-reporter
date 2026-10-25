import { stripVTControlCharacters } from 'node:util';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
// Preserve our zero-width SGR color spans when splitting a long word.
// oxlint-disable-next-line no-control-regex -- ANSI SGR sequences are layout metadata.
const sgr = /(\u001b\[[\d;]*m)/g;

function cellWidth(grapheme: string): number {
    if (/^[\p{Mark}\p{Default_Ignorable_Code_Point}]+$/u.test(grapheme))
        return 0;
    if (
        !grapheme.includes('\ufe0e') &&
        (grapheme.includes('\ufe0f') ||
            grapheme.includes('\u20e3') ||
            /\p{Emoji_Presentation}/u.test(grapheme))
    )
        return 2;
    const point = grapheme.codePointAt(0) ?? 0;
    // Wide/fullwidth terminal cells; ambiguous characters use the usual narrow width.
    const wide =
        point >= 0x1100 &&
        (point <= 0x115f ||
            point === 0x2329 ||
            point === 0x232a ||
            (point >= 0x2e80 && point <= 0xa4cf && point !== 0x303f) ||
            (point >= 0xac00 && point <= 0xd7a3) ||
            (point >= 0xf900 && point <= 0xfaff) ||
            (point >= 0xfe10 && point <= 0xfe19) ||
            (point >= 0xfe30 && point <= 0xfe6f) ||
            (point >= 0xff01 && point <= 0xff60) ||
            (point >= 0xffe0 && point <= 0xffe6) ||
            (point >= 0x1b000 && point <= 0x1b2ff) ||
            (point >= 0x1f200 && point <= 0x1f251) ||
            (point >= 0x20000 && point <= 0x3fffd));
    return wide ? 2 : 1;
}

export function displayWidth(value: string): number {
    const plain = stripVTControlCharacters(value);
    if (/^[\x20-\x7e]*$/.test(plain)) return plain.length;
    let width = 0;
    for (const { segment } of graphemes.segment(plain))
        width += cellWidth(segment);
    return width;
}

export function truncateCells(value: string, columns: number): string {
    const plain = stripVTControlCharacters(value);
    if (columns <= 0) return '';
    if (displayWidth(plain) <= columns) return plain;
    let text = '';
    let width = 0;
    for (const { segment } of graphemes.segment(plain)) {
        const size = cellWidth(segment);
        if (width + size > columns - 1) break;
        text += segment;
        width += size;
    }
    return text + '…';
}

/** Keep a path on one line, removing parent directories before shortening its filename. */
export function fitPath(value: string, columns: number, ascii = false): string {
    const plain = stripVTControlCharacters(value);
    if (columns <= 0) return '';
    if (displayWidth(plain) <= columns) return plain;
    const marker = ascii ? '...' : '…';
    const separator = plain.includes('\\') && !plain.includes('/') ? '\\' : '/';
    const parts = plain.split(/[/\\]/).filter(Boolean);
    const filename = parts.pop() ?? plain;
    let suffix = filename;
    while (parts.length) {
        const candidate = parts.pop()! + separator + suffix;
        if (displayWidth(marker + separator + candidate) > columns) break;
        suffix = candidate;
    }
    if (displayWidth(marker + separator + suffix) <= columns)
        return marker + separator + suffix;
    if (displayWidth(filename) <= columns) return filename;
    if (columns <= marker.length) return marker.slice(0, columns);
    const cells = Array.from(
        graphemes.segment(filename),
        (item) => item.segment,
    );
    let start = 0,
        end = cells.length;
    let left = '',
        right = '';
    let leftWidth = 0,
        rightWidth = 0;
    let room = columns - marker.length;
    while (start < end) {
        const fromLeft = leftWidth <= rightWidth;
        const cell = cells[fromLeft ? start : end - 1]!;
        const size = cellWidth(cell);
        if (size > room) break;
        if (fromLeft) {
            left += cell;
            leftWidth += size;
            start++;
        } else {
            right = cell + right;
            rightWidth += size;
            end--;
        }
        room -= size;
    }
    return left + marker + right;
}

/** Wrap preformatted diagnostics without losing their original hanging indentation. */
export function indentLines(
    value: string,
    indent: number,
    columns: number,
): string {
    return value
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => {
            const leading = line.match(/^[ \t]*/)?.[0] ?? '';
            const spaces = Math.min(
                indent + leading.replaceAll('\t', '    ').length,
                Math.max(0, columns - 12),
            );
            const body = line
                .slice(leading.length)
                .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ');
            return hangingIndent(' '.repeat(spaces), body, columns).slice(
                0,
                -1,
            );
        })
        .join('\n');
}

interface StyledCell {
    text: string;
    style: string;
    width: number;
}

function styledCells(value: string): StyledCell[] {
    const cells: StyledCell[] = [];
    let style = '';
    for (const part of value.split(sgr)) {
        if (part.startsWith('\u001b')) {
            style =
                part === '\u001b[0m' || part === '\u001b[m' ? '' : style + part;
            continue;
        }
        for (const { segment } of graphemes.segment(part))
            cells.push({ text: segment, style, width: cellWidth(segment) });
    }
    return cells;
}

/** Repaint only the changed cells, preserving graphemes and their SGR styles. */
export function linePatch(
    before: string,
    after: string,
): { column: number; text: string } | undefined {
    if (before === after) return undefined;
    const previous = styledCells(before);
    const next = styledCells(after);
    const same = (left: StyledCell, right: StyledCell): boolean =>
        left.text === right.text && left.style === right.style;
    let start = 0;
    let column = 0;
    while (
        start < previous.length &&
        start < next.length &&
        same(previous[start]!, next[start]!)
    ) {
        column += next[start]!.width;
        start++;
    }
    let endBefore = previous.length;
    let endAfter = next.length;
    if (displayWidth(before) === displayWidth(after)) {
        while (
            endBefore > start &&
            endAfter > start &&
            same(previous[endBefore - 1]!, next[endAfter - 1]!)
        ) {
            endBefore--;
            endAfter--;
        }
    }
    let text = '\u001b[0m';
    let style = '';
    let width = 0;
    for (const cell of next.slice(start, endAfter)) {
        if (cell.style !== style) {
            text += '\u001b[0m' + cell.style;
            style = cell.style;
        }
        text += cell.text;
        width += cell.width;
    }
    const oldWidth = previous
        .slice(start, endBefore)
        .reduce((total, cell) => total + cell.width, 0);
    return {
        column,
        text: text + '\u001b[0m' + ' '.repeat(Math.max(0, oldWidth - width)),
    };
}

function splitWord(value: string, columns: number): string[] {
    const lines: string[] = [];
    let line = '';
    let width = 0;
    for (const part of value.split(sgr)) {
        if (part.startsWith('\u001b')) {
            line += part;
            continue;
        }
        for (const { segment } of graphemes.segment(part)) {
            const size = cellWidth(segment);
            if (width && width + size > columns) {
                lines.push(line);
                line = '';
                width = 0;
            }
            line += segment;
            width += size;
        }
    }
    if (line) lines.push(line);
    return lines;
}

/** Word-wrap styled text, with every continuation aligned beneath the first text cell. */
export function hangingIndent(
    prefix: string,
    body: string,
    columns: number,
): string {
    const indent = ' '.repeat(displayWidth(prefix));
    const available = Math.max(2, columns - indent.length);
    const lines: string[] = [];
    let line = '';
    let width = 0;
    let spaces = '';
    for (const [token] of body.matchAll(/\s+|\S+/gu)) {
        if (/^\s/u.test(token)) {
            spaces += token;
            continue;
        }
        const size = displayWidth(token);
        if (width && width + spaces.length + size > available) {
            lines.push(line);
            line = '';
            width = 0;
        }
        if (size > available) {
            const pieces = splitWord(line + token, available);
            line = pieces.pop() ?? '';
            lines.push(...pieces);
            width = displayWidth(line);
        } else {
            const gap = width ? spaces : '';
            line += gap + token;
            width += gap.length + size;
        }
        spaces = '';
    }
    if (line || !lines.length) lines.push(line);
    return (
        lines
            .map((value, index) => `${index ? indent : prefix}${value}`)
            .join('\n') + '\n'
    );
}
