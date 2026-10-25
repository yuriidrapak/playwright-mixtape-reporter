import {
    test as base,
    type BrowserContext,
    type Request,
} from '@playwright/test';
import { channel } from 'node:diagnostics_channel';
import type { ClientRequest } from 'node:http';
import type { Socket } from 'node:net';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { metricsEnvironment, type WorkerSample } from './metrics-monitor.ts';

/** Observes byte counters only; never reads bodies, URLs, headers or credentials. */
export class WorkerMetrics {
    private readonly startedAt = Date.now();
    private readonly sockets = new Map<
        Socket,
        { received: number; sent: number; close: () => void }
    >();
    private readonly contexts = new Map<
        BrowserContext,
        { finished: (request: Request) => void; close: () => void }
    >();
    private readonly requests = new Map<ClientRequest, () => void>();
    private active = false;
    private stopping: Promise<void> | undefined;
    private received = 0;
    private sent = 0;
    private readonly pendingRequests = new Set<Promise<void>>();
    private timer: ReturnType<typeof setInterval> | undefined;
    private pending: Promise<void> = Promise.resolve();
    private writing = false;
    private readonly http = channel('http.client.request.start');
    private readonly onRequest = (message: unknown): void => {
        if (!this.active || !message || typeof message !== 'object') return;
        const request = (message as { request?: ClientRequest }).request;
        if (!request) return;
        const observe = (socket: Socket): void => {
            if (!this.active || this.sockets.has(socket)) return;
            const close = (): void => this.collectSocket(socket, true);
            // The diagnostics event may fire after the first request bytes are written.
            this.sockets.set(socket, { received: 0, sent: 0, close });
            socket.once('close', close);
        };
        const upgrade = (): void => {
            if (request.socket) this.collectSocket(request.socket, true);
            cleanup();
        };
        const cleanup = (): void => {
            request.off('socket', observe);
            request.off('upgrade', upgrade);
            request.off('close', cleanup);
            this.requests.delete(request);
        };
        this.requests.set(request, cleanup);
        request.once('upgrade', upgrade);
        request.once('close', cleanup);
        if (request.socket) observe(request.socket);
        else request.once('socket', observe);
    };

    private readonly directory: string;
    private readonly workerIndex: number;

    constructor(directory: string, workerIndex: number) {
        this.directory = directory;
        this.workerIndex = workerIndex;
    }

    start(): void {
        if (this.active || this.stopping) return;
        this.active = true;
        this.http.subscribe(this.onRequest);
        this.timer = setInterval(() => this.flush(), 1000);
        this.timer.unref();
        this.flush();
    }

    observeContext(context: BrowserContext): void {
        if (!this.active || this.contexts.has(context)) return;
        const listener = (request: Request): void => {
            const pending = request
                .sizes()
                .then((sizes) => {
                    this.received +=
                        Math.max(0, sizes.responseBodySize) +
                        Math.max(0, sizes.responseHeadersSize);
                    this.sent +=
                        Math.max(0, sizes.requestBodySize) +
                        Math.max(0, sizes.requestHeadersSize);
                })
                .catch(() => {
                    /* Closed contexts and unsupported requests have no sample. */
                })
                .finally(() => this.pendingRequests.delete(pending));
            this.pendingRequests.add(pending);
        };
        const close = (): void => {
            context.off('requestfinished', listener);
            this.contexts.delete(context);
        };
        this.contexts.set(context, { finished: listener, close });
        context.on('requestfinished', listener);
        context.once('close', close);
    }

    stop(): Promise<void> {
        this.stopping ??= this.cleanup();
        return this.stopping;
    }

    private async cleanup(): Promise<void> {
        if (!this.active) return;
        this.active = false;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        this.http.unsubscribe(this.onRequest);
        for (const cleanup of this.requests.values()) cleanup();
        this.requests.clear();
        for (const [context, listeners] of this.contexts) {
            context.off('requestfinished', listeners.finished);
            context.off('close', listeners.close);
        }
        this.contexts.clear();
        await Promise.allSettled(this.pendingRequests);
        await this.pending;
        this.flush();
        await this.pending;
        for (const [socket, sample] of this.sockets)
            socket.off('close', sample.close);
        this.sockets.clear();
    }

    private collectSocket(socket: Socket, remove = false): void {
        const previous = this.sockets.get(socket);
        if (!previous) return;
        this.received += Math.max(0, socket.bytesRead - previous.received);
        this.sent += Math.max(0, socket.bytesWritten - previous.sent);
        if (remove) {
            socket.off('close', previous.close);
            this.sockets.delete(socket);
        } else
            this.sockets.set(socket, {
                received: socket.bytesRead,
                sent: socket.bytesWritten,
                close: previous.close,
            });
    }

    private flush(): void {
        if (this.writing) return;
        for (const socket of this.sockets.keys()) this.collectSocket(socket);
        const sample: WorkerSample = {
            workerIndex: this.workerIndex,
            startedAt: this.startedAt,
            at: Date.now(),
            received: this.received,
            sent: this.sent,
        };
        const file = join(this.directory, `worker-${this.workerIndex}.json`);
        this.writing = true;
        this.pending = writeFile(file + '.tmp', JSON.stringify(sample), {
            mode: 0o600,
        })
            .then(() => rename(file + '.tmp', file))
            .catch(() => {
                /* Monitoring is optional and must never fail a test. */
            })
            .finally(() => {
                this.writing = false;
            });
    }
}

/** Extend or merge this test with existing fixtures to opt in to worker metrics. */
export const test = base.extend<
    Record<never, never>,
    { mixtapeMetrics: WorkerMetrics | undefined }
>({
    mixtapeMetrics: [
        // oxlint-disable-next-line no-empty-pattern -- Playwright requires fixture destructuring.
        async ({}, use, workerInfo) => {
            const directory = process.env[metricsEnvironment];
            const metrics = directory
                ? new WorkerMetrics(directory, workerInfo.workerIndex)
                : undefined;
            metrics?.start();
            try {
                await use(metrics);
            } finally {
                await metrics?.stop();
            }
        },
        { scope: 'worker', auto: true },
    ],
    context: async ({ context, mixtapeMetrics }, use) => {
        mixtapeMetrics?.observeContext(context);
        await use(context);
    },
});

export { expect } from '@playwright/test';
