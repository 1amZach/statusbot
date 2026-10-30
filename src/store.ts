import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Status } from './status.js';

// What survives a restart: the panel message to keep editing, and each server's status.
export interface Saved {
    messages: Record<string, string>;
    status: Record<string, Status>;
}

const FILE = 'data/state.json';

export function load(): Saved {
    try {
        const data = JSON.parse(readFileSync(FILE, 'utf8'));
        return { messages: data.messages ?? {}, status: data.status ?? {} };
    } catch {
        return { messages: {}, status: {} };
    }
}

export function save(state: Saved): void {
    mkdirSync(dirname(FILE), { recursive: true });
    // write then rename so a crash mid-write can't leave a half file behind
    writeFileSync(`${FILE}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${FILE}.tmp`, FILE);
}
