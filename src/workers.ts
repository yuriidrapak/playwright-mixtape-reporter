import type { TestCase, TestResult } from '@playwright/test/reporter';
import type { Status } from './colors.ts';

export type WorkerTest = Pick<
    TestCase,
    'title' | 'expectedStatus' | 'retries'
> &
    Partial<Pick<TestCase, 'location'>>;
export type WorkerResult = Pick<
    TestResult,
    'parallelIndex' | 'workerIndex' | 'retry' | 'status' | 'duration'
>;
export type Phase = 'idle' | 'running' | 'retry' | Status;
const loadTransitionMs = 720;
const loadStartDelayMs = 120;

export interface Runner {
    slot: number;
    phase: Phase;
    test: WorkerTest | undefined;
    workerIndex: number;
    startedAt: number;
    duration: number;
    retry: number;
    takes: number;
}

/** Tracks logical parallel slots, which survive Playwright worker-process restarts. */
export class LiveRun {
    readonly counts: Record<Status, number> = {
        passed: 0,
        failed: 0,
        flaky: 0,
        skipped: 0,
        interrupted: 0,
        notRun: 0,
    };
    runners: Runner[] = [];
    total = 0;
    peak = 0;
    retries = 0;
    private startedAt = 0;
    private readonly completed = new Map<WorkerTest, Status>();
    private readonly clock: () => number;

    constructor(clock: () => number = () => performance.now()) {
        this.clock = clock;
    }

    reset(total: number, workers: number): void {
        this.total = total;
        this.peak = 0;
        this.retries = 0;
        this.startedAt = this.clock();
        this.completed.clear();
        for (const status of Object.keys(this.counts) as Status[])
            this.counts[status] = 0;
        this.runners = Array.from({ length: workers }, (_, slot) =>
            this.idle(slot),
        );
    }

    get active(): number {
        return this.runners.filter((runner) => runner.phase === 'running')
            .length;
    }

    get done(): number {
        return this.completed.size;
    }

    get elapsed(): number {
        return Math.max(0, this.clock() - this.startedAt);
    }

    elapsedFor(runner: Runner): number {
        return runner.phase === 'running'
            ? Math.max(0, this.clock() - runner.startedAt)
            : runner.duration;
    }

    /** Clear completed attempts immediately, then ease each new attempt in after a handoff frame. */
    loadFor(runner: Runner): number {
        if (runner.phase !== 'running') return 0;
        const progress = Math.max(
            0,
            Math.min(
                1,
                (this.clock() - runner.startedAt - loadStartDelayMs) /
                    loadTransitionMs,
            ),
        );
        return progress * progress * (3 - 2 * progress);
    }

    begin(test: WorkerTest, result: WorkerResult): void {
        if (!this.realWorker(result)) return;
        while (this.runners.length <= result.parallelIndex)
            this.runners.push(this.idle(this.runners.length));
        const runner = this.runners[result.parallelIndex]!;
        if (
            runner.phase === 'running' &&
            runner.test === test &&
            runner.workerIndex === result.workerIndex &&
            runner.retry === result.retry
        )
            return;
        Object.assign(runner, {
            phase: 'running',
            test,
            workerIndex: result.workerIndex,
            startedAt: this.clock(),
            retry: result.retry,
            duration: 0,
        });
        if (result.retry > 0) this.retries++;
        this.peak = Math.max(this.peak, this.active);
    }

    end(test: WorkerTest, result: WorkerResult, status: Status): void {
        const retrying = status === 'failed' && result.retry < test.retries;
        if (!retrying) {
            const previous = this.completed.get(test);
            if (previous) this.counts[previous]--;
            this.completed.set(test, status);
            this.counts[status]++;
        }
        if (!this.realWorker(result)) return;
        const runner = this.runners[result.parallelIndex];
        if (
            !runner ||
            runner.test !== test ||
            runner.workerIndex !== result.workerIndex ||
            runner.phase !== 'running'
        )
            return;
        runner.phase = retrying ? 'retry' : status;
        runner.duration = result.duration;
        runner.takes++;
    }

    release(): void {
        this.completed.clear();
        for (const runner of this.runners) {
            runner.test = undefined;
            runner.phase = 'idle';
        }
    }

    private realWorker(result: WorkerResult): boolean {
        return (
            Number.isInteger(result.parallelIndex) &&
            result.parallelIndex >= 0 &&
            Number.isInteger(result.workerIndex) &&
            result.workerIndex >= 0
        );
    }

    private idle(slot: number): Runner {
        return {
            slot,
            phase: 'idle',
            test: undefined,
            workerIndex: -1,
            startedAt: 0,
            duration: 0,
            retry: 0,
            takes: 0,
        };
    }
}
