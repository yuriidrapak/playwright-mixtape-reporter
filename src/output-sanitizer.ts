import { StringDecoder } from 'node:string_decoder';

function safeStyles(sequence: string): string[] | undefined {
    if (!/^[\d;:]*$/.test(sequence)) return undefined;
    const parameters = sequence.split(';');
    const styles: string[] = [];
    const byte = (value: string | undefined): boolean =>
        value !== undefined && /^\d{1,3}$/.test(value) && Number(value) <= 255;
    for (let i = 0; i < parameters.length; i++) {
        const value = parameters[i]!;
        const parts = value.split(':');
        const code = Number(parts[0]);
        if (code === 38 || code === 48) {
            if (parts.length > 1) {
                const colors = parts.slice(parts.length === 6 ? 3 : 2);
                if (!(
                    (parts[1] === '5' && parts.length === 3) ||
                    (parts[1] === '2' &&
                        (parts.length === 5 ||
                            (parts.length === 6 &&
                                ['', '0'].includes(parts[2]!))))
                ))
                    return undefined;
                if (!colors.every(byte)) return undefined;
                styles.push(value);
            } else {
                const mode = parameters[++i];
                const count = mode === '5' ? 1 : mode === '2' ? 3 : 0;
                const colors = parameters.slice(i + 1, i + 1 + count);
                if (!count || colors.length !== count || !colors.every(byte))
                    return undefined;
                styles.push([String(code), mode, ...colors].join(';'));
                i += count;
            }
        } else {
            if (
                parts.length !== 1 ||
                !(
                    [0, 1, 2, 3, 4, 22, 23, 24, 39, 49].includes(code) ||
                    (code >= 30 && code <= 37) ||
                    (code >= 40 && code <= 47) ||
                    (code >= 90 && code <= 97) ||
                    (code >= 100 && code <= 107)
                )
            )
                return undefined;
            styles.push(String(code));
        }
    }
    return styles;
}

/** Incremental terminal filter: retain text and optional SGR colors, never terminal commands. */
export class OutputSanitizer {
    private readonly decoder = new StringDecoder('utf8');
    private state: 'text' | 'escape' | 'csi' | 'string' | 'stringEscape' =
        'text';
    private sequence = '';
    private readonly colors: boolean;
    private readonly styles = new Map<number, string>();

    constructor(colors = false) {
        this.colors = colors;
    }

    /** Bounded active style, so callers can restore it after isolating output writes. */
    get style(): string {
        return this.styles.size
            ? `\u001b[${[...this.styles.values()].join(';')}m`
            : '';
    }

    end(): string {
        const tail = this.write(this.decoder.end());
        this.state = 'text';
        this.sequence = '';
        this.styles.clear();
        return tail;
    }

    private remember(styles: string[]): void {
        for (const style of styles) {
            const code = Number(style.split(/[;:]/)[0]);
            if (code === 0) this.styles.clear();
            else if (code === 22) {
                this.styles.delete(1);
                this.styles.delete(2);
            } else if (code === 23 || code === 24)
                this.styles.delete(code - 20);
            else if (code === 39 || code === 49) this.styles.delete(code - 1);
            else
                this.styles.set(
                    code >= 30
                        ? code < 40 || (code >= 90 && code < 100)
                            ? 38
                            : 48
                        : code,
                    style,
                );
        }
    }

    write(chunk: string | Buffer): string {
        const value =
            typeof chunk === 'string'
                ? this.decoder.end() + chunk
                : this.decoder.write(chunk);
        let output = '';
        for (const char of value) {
            if (this.state === 'string' || this.state === 'stringEscape') {
                if (
                    char === '\u0007' ||
                    char === '\u009c' ||
                    (this.state === 'stringEscape' && char === '\\')
                )
                    this.state = 'text';
                else this.state = char === '\u001b' ? 'stringEscape' : 'string';
                continue;
            }
            if (char === '\u001b') {
                this.state = 'escape';
                this.sequence = '';
                continue;
            }
            if (this.state === 'escape') {
                if (char === '[') this.state = 'csi';
                else if (']PX^_'.includes(char)) this.state = 'string';
                else if (char >= '0' && char <= '~') this.state = 'text';
                continue;
            }
            if (this.state === 'csi') {
                if (char >= '@' && char <= '~') {
                    const styles =
                        this.colors && char === 'm'
                            ? safeStyles(this.sequence)
                            : undefined;
                    if (styles) {
                        output += `\u001b[${this.sequence}m`;
                        this.remember(styles);
                    }
                    this.state = 'text';
                    this.sequence = '';
                } else if (this.sequence.length < 64) this.sequence += char;
                else this.sequence = '!'; // Invalidate oversized SGR without retaining its payload.
                continue;
            }
            if (char === '\u009b') {
                this.state = 'csi';
                this.sequence = '';
            } else if ('\u0090\u009d\u009e\u009f\u0098'.includes(char))
                this.state = 'string';
            else if (
                char === '\n' ||
                char === '\t' ||
                !/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/u.test(char)
            )
                output += char;
        }
        return output;
    }
}
