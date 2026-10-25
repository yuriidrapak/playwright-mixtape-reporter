import { emitKeypressEvents, type Key } from 'node:readline';
import { PassThrough } from 'node:stream';

export interface PanelView {
    enabled: boolean;
    selected: number | null;
    inspecting: boolean;
    held: boolean;
}

/** Own input only on an otherwise unclaimed TTY, and restore its original state. */
export class TerminalControls {
    readonly view: PanelView = {
        enabled: false,
        selected: null,
        inspecting: false,
        held: false,
    };
    private readonly input: NodeJS.ReadStream;
    private readonly count: () => number;
    private readonly changed: () => void;
    private readonly interrupt: () => void;
    private wasPaused = true;
    private parser: PassThrough | undefined;
    private readonly onData = (chunk: string | Buffer): void => {
        this.parser?.write(chunk);
    };
    private readonly onKey = (_value: string, key: Key = {}): void => {
        if (key.ctrl && key.name === 'c') {
            this.stop();
            this.interrupt();
            return;
        }
        if (key.ctrl || key.meta) return;
        const count = this.count();
        if (key.name === 'down' && count)
            this.view.selected =
                this.view.selected === null
                    ? 0
                    : (this.view.selected + 1) % count;
        else if (key.name === 'up' && count)
            this.view.selected =
                this.view.selected === null
                    ? count - 1
                    : (this.view.selected + count - 1) % count;
        else if (key.name === 'return' && count) {
            this.view.selected ??= 0;
            this.view.inspecting = !this.view.inspecting;
        } else if (key.name === 'escape') {
            this.view.inspecting = false;
            this.view.selected = null;
        } else if (key.name === 'p') this.view.held = !this.view.held;
        else return;
        this.changed();
    };

    constructor(
        count: () => number,
        changed: () => void,
        input: NodeJS.ReadStream = process.stdin,
        interrupt = () => {
            process.kill(process.pid, 'SIGINT');
        },
    ) {
        this.count = count;
        this.changed = changed;
        this.input = input;
        this.interrupt = interrupt;
    }

    start(): void {
        if (
            this.view.enabled ||
            !this.input.isTTY ||
            this.input.isRaw ||
            this.input.listenerCount('data') ||
            this.input.listenerCount('keypress')
        )
            return;
        this.wasPaused = this.input.readableFlowing !== true;
        try {
            this.parser = new PassThrough();
            emitKeypressEvents(this.parser);
            this.parser.on('keypress', this.onKey);
            this.input.on('data', this.onData);
            this.input.setRawMode(true);
            this.input.resume();
            this.view.enabled = true;
        } catch {
            this.input.off('data', this.onData);
            this.parser?.destroy();
            this.parser = undefined;
            try {
                if (this.input.isRaw) this.input.setRawMode(false);
            } catch {
                /* The TTY may have closed. */
            }
            if (this.wasPaused) this.input.pause();
        }
    }

    stop(): void {
        if (!this.view.enabled) return;
        this.input.off('data', this.onData);
        this.parser?.destroy();
        this.parser = undefined;
        try {
            this.input.setRawMode(false);
        } catch {
            /* The input TTY may already be closed. */
        }
        if (this.wasPaused) this.input.pause();
        Object.assign(this.view, {
            enabled: false,
            selected: null,
            inspecting: false,
            held: false,
        });
    }
}
