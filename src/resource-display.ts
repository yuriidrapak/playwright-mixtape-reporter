import type { ResourceLoad } from './metrics-monitor.ts';

export interface ResourceDisplay extends ResourceLoad {
    /** Combined HTTP bytes/second, sampled at 240 ms display intervals. */
    history?: readonly number[];
}

/** Time-based display damping; collection and raw rate calculations stay unchanged. */
export class ResourceAnimation {
    private value: ResourceLoad | undefined;
    private updatedAt = 0;
    private historyAt = 0;
    private history: number[] = [];

    next(
        target: ResourceLoad | null,
        now = performance.now(),
    ): ResourceDisplay | null {
        if (!target) {
            this.reset();
            return null;
        }
        if (!this.value) {
            this.value = { ...target };
            this.updatedAt = now;
            this.historyAt = now - 240;
        } else {
            const elapsed = Math.max(0, now - this.updatedAt);
            this.updatedAt = now;
            for (const key of ['cpu', 'received', 'sent'] as const) {
                const available =
                    key === 'cpu' ? 'cpuAvailable' : 'networkAvailable';
                if (
                    target[available] === false ||
                    this.value[available] === false
                ) {
                    this.value[key] = target[key];
                    continue;
                }
                const previous = this.value[key];
                const rising = target[key] > previous;
                const timeConstant =
                    key === 'cpu'
                        ? rising
                            ? 600
                            : 1200
                        : rising
                          ? 1000
                          : 2400;
                const alpha = -Math.expm1(-elapsed / timeConstant);
                const next = previous + (target[key] - previous) * alpha;
                this.value[key] =
                    target[key] === 0 && next < (key === 'cpu' ? 0.1 : 1)
                        ? 0
                        : next;
            }
        }
        this.value.cpuAvailable = target.cpuAvailable ?? true;
        this.value.networkAvailable = target.networkAvailable ?? true;
        if (!this.value.networkAvailable) this.history = [];
        if (this.value.networkAvailable && now - this.historyAt >= 240) {
            this.historyAt = now;
            this.history.push(this.value.received + this.value.sent);
            this.history = this.history.slice(-12);
        }
        return { ...this.value, history: [...this.history] };
    }

    reset(): void {
        this.value = undefined;
        this.history = [];
        this.updatedAt = 0;
        this.historyAt = 0;
    }
}
