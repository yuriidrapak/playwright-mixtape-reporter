import { StringDecoder } from 'node:string_decoder';

/** Incremental terminal filter: retain text and optional SGR colors, never terminal commands. */
export class OutputSanitizer {
    private readonly decoder = new StringDecoder('utf8');
    private state: 'text' | 'escape' | 'csi' | 'string' | 'stringEscape' =
        'text';
    private sequence = '';
    private readonly colors: boolean;

    constructor(colors = false) {
        this.colors = colors;
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
                    if (
                        this.colors &&
                        char === 'm' &&
                        /^[\d;:]*$/.test(this.sequence)
                    )
                        output += `\u001b[${this.sequence}m`;
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
