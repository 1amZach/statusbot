import type { Snapshot } from './fivem.js';

export interface Status {
    online: boolean;
    // when it last went online or offline (ms)
    since: number;
    failures: number;
    peak: number;
    peakDay: string;
    // last snapshot that came back online, used for the name and banner while it's down
    last?: Snapshot;
    checked: number;
}

export type Change = 'online' | 'offline' | null;

export function dayKey(time: number): string {
    const d = new Date(time);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function initial(now: number): Status {
    return { online: false, since: now, failures: 0, peak: 0, peakDay: dayKey(now), checked: 0 };
}

/*
    Works out the next status from a poll. `snapshot` is null when the request itself failed.
    A server only counts as offline after `threshold` bad polls in a row, so one slow answer
    doesn't fire an alert. The very first poll never reports a change.
*/
export function next(prev: Status, snapshot: Snapshot | null, now: number, threshold: number): { status: Status; change: Change } {
    const first = prev.checked === 0;
    const status: Status = { ...prev, checked: now };

    if (status.peakDay !== dayKey(now)) {
        status.peak = 0;
        status.peakDay = dayKey(now);
    }

    if (snapshot?.online) {
        status.failures = 0;
        status.last = snapshot;
        status.peak = Math.max(status.peak, snapshot.clients);

        if (!prev.online) {
            status.online = true;
            status.since = now;
            return { status, change: first ? null : 'online' };
        }

        return { status, change: null };
    }

    status.failures = prev.failures + 1;

    if (first) {
        status.online = false;
        status.since = now;
        return { status, change: null };
    }

    if (prev.online && status.failures >= threshold) {
        status.online = false;
        status.since = now;
        return { status, change: 'offline' };
    }

    return { status, change: null };
}
