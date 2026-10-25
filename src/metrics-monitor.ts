import { mkdtempSync, rmSync } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { cpus, tmpdir, type CpuInfo } from 'node:os';
import { join } from 'node:path';

export const metricsEnvironment = 'PLAYWRIGHT_MIXTAPE_METRICS_DIRECTORY';

export interface WorkerSample {
    workerIndex: number;
    at: number;
    startedAt: number;
    received: number;
    sent: number;
}

export interface ResourceLoad {
    cpu: number;
    received: number;
    sent: number;
    cpuAvailable?: boolean;
    networkAvailable?: boolean;
}

/** Utilization across all logical CPUs, independent of test-worker activity. */
export class SystemCpu {
    private previous:
        { total: number; idle: number; cores: number } | undefined;
    value = 0;
    available = false;
    private readonly read: () => readonly Pick<CpuInfo, 'times'>[];

    constructor(read: () => readonly Pick<CpuInfo, 'times'>[] = cpus) {
        this.read = read;
    }

    sample(): void {
        try {
            const cores = this.read();
            const current = cores.reduce(
                (sum, { times }) => ({
                    total:
                        sum.total +
                        times.user +
                        times.nice +
                        times.sys +
                        times.irq +
                        times.idle,
                    idle: sum.idle + times.idle,
                    cores: cores.length,
                }),
                { total: 0, idle: 0, cores: cores.length },
            );
            const previous = this.previous;
            this.previous = current;
            if (
                !previous ||
                !current.cores ||
                current.cores !== previous.cores ||
                current.total <= previous.total ||
                current.idle < previous.idle
            ) {
                this.available = false;
                return;
            }
            this.value = Math.max(
                0,
                Math.min(
                    100,
                    100 *
                        (1 -
                            (current.idle - previous.idle) /
                                (current.total - previous.total)),
                ),
            );
            this.available = true;
        } catch {
            this.previous = undefined;
            this.available = false;
        }
    }

    reset(): void {
        this.previous = undefined;
        this.value = 0;
        this.available = false;
    }
}

/** System CPU and a single rate window containing byte deltas from every worker. */
export class MetricsMonitor {
    private directory: string | undefined;
    private previousEnvironment: string | undefined;
    private samples = new Map<number, WorkerSample>();
    private polling = false;
    private networkAt: number | undefined;
    private pending = { received: 0, sent: 0 };
    private network = { received: 0, sent: 0 };
    private readonly cpu: SystemCpu;
    private readonly clock: () => number;

    constructor(cpu = new SystemCpu(), clock: () => number = Date.now) {
        this.cpu = cpu;
        this.clock = clock;
    }

    start(): void {
        if (this.directory) return;
        this.cpu.reset();
        this.cpu.sample();
        this.networkAt = this.clock();
        try {
            this.directory = mkdtempSync(
                join(tmpdir(), 'playwright-mixtape-metrics-'),
            );
            this.previousEnvironment = process.env[metricsEnvironment];
            process.env[metricsEnvironment] = this.directory;
        } catch {
            // System CPU remains available even when network snapshots cannot be stored.
        }
    }

    async poll(): Promise<void> {
        if (this.polling) return;
        this.polling = true;
        const directory = this.directory;
        try {
            if (!directory) return;
            const files = (await readdir(directory)).filter((file) =>
                /^worker-\d+\.json$/.test(file),
            );
            // Retries create new worker files. Bound both concurrent descriptors and
            // bytes per snapshot even when a long run has thousands of workers.
            for (let offset = 0; offset < files.length; offset += 16) {
                const values = await Promise.allSettled(
                    files.slice(offset, offset + 16).map(async (file) => {
                        const handle = await open(join(directory, file), 'r');
                        try {
                            const buffer = Buffer.alloc(4097);
                            const { bytesRead } = await handle.read(
                                buffer,
                                0,
                                buffer.length,
                                0,
                            );
                            if (bytesRead > 4096) return undefined;
                            const value: unknown = JSON.parse(
                                buffer.toString('utf8', 0, bytesRead),
                            );
                            return isSample(value) &&
                                file === `worker-${value.workerIndex}.json`
                                ? value
                                : undefined;
                        } finally {
                            await handle.close();
                        }
                    }),
                );
                if (this.directory !== directory) return;
                for (const value of values) {
                    if (value.status === 'fulfilled' && value.value)
                        this.accept(value.value);
                }
            }
        } catch {
            // Concurrent cleanup or a missed sample must not change test execution.
        } finally {
            if (this.directory === directory) this.sampleRates();
            this.polling = false;
        }
    }

    accept(sample: WorkerSample): void {
        const previous = this.samples.get(sample.workerIndex);
        if (previous && sample.at <= previous.at) return;
        this.networkAt ??= sample.startedAt;
        this.pending.received += Math.max(
            0,
            sample.received - (previous?.received ?? 0),
        );
        this.pending.sent += Math.max(0, sample.sent - (previous?.sent ?? 0));
        this.samples.set(sample.workerIndex, sample);
    }

    sampleRates(now = this.clock()): void {
        this.cpu.sample();
        const elapsed = now - (this.networkAt ?? now);
        if (elapsed <= 0) return;
        this.network = {
            received: (this.pending.received * 1000) / elapsed,
            sent: (this.pending.sent * 1000) / elapsed,
        };
        this.networkAt = now;
        this.pending = { received: 0, sent: 0 };
    }

    current(
        requiredWorkers: readonly number[],
        now = this.clock(),
    ): ResourceLoad {
        const covered = requiredWorkers.every((index) => {
            const sample = this.samples.get(index);
            return sample && now - sample.at <= 2500;
        });
        return {
            cpu: this.cpu.value,
            ...this.network,
            cpuAvailable: this.cpu.available,
            networkAvailable: covered,
        };
    }

    stop(): void {
        const directory = this.directory;
        this.directory = undefined;
        this.samples.clear();
        this.cpu.reset();
        this.networkAt = undefined;
        this.pending = { received: 0, sent: 0 };
        this.network = { received: 0, sent: 0 };
        if (!directory) return;
        if (process.env[metricsEnvironment] === directory) {
            if (this.previousEnvironment === undefined)
                delete process.env[metricsEnvironment];
            else process.env[metricsEnvironment] = this.previousEnvironment;
        }
        try {
            rmSync(directory, { recursive: true, force: true });
        } catch {
            /* Best-effort cleanup. */
        }
    }
}

function isSample(value: unknown): value is WorkerSample {
    if (!value || typeof value !== 'object') return false;
    const sample = value as Record<string, unknown>;
    return (
        ['workerIndex', 'at', 'startedAt', 'received', 'sent'].every(
            (key) =>
                typeof sample[key] === 'number' &&
                Number.isFinite(sample[key]) &&
                sample[key] >= 0,
        ) && Number.isInteger(sample.workerIndex)
    );
}
