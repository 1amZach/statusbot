// Fetching server info, either through the Cfx server list (join codes) or straight from the server (ip:port).

export interface Player {
    id: number;
    name: string;
    ping: number;
}

export interface Snapshot {
    online: boolean;
    name: string;
    clients: number;
    max: number;
    players: Player[];
    // false when the server hides its player list
    playersVisible: boolean;
    banner?: string;
    icon?: string;
    connect?: string;
}

const TIMEOUT = 8000;
const LIST_API = 'https://frontend.cfx-services.net/api/servers/single/';
// the server list keeps a server for a while after it goes down, so treat stale entries as offline
const STALE_AFTER = 5 * 60 * 1000;

export type Target = { kind: 'cfx'; code: string } | { kind: 'direct'; host: string };

export function parseAddress(address: string): Target {
    const trimmed = address.trim();
    const join = trimmed.match(/^(?:https?:\/\/)?cfx\.re\/join\/([a-z0-9]+)\/?$/i);

    if (join?.[1]) return { kind: 'cfx', code: join[1].toLowerCase() };
    if (/^[a-z0-9]{6}$/i.test(trimmed)) return { kind: 'cfx', code: trimmed.toLowerCase() };

    const host = trimmed.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!/^[\w.-]+:\d+$/.test(host)) {
        throw new Error(`"${address}" isn't a cfx.re join link, a join code, or ip:port`);
    }

    return { kind: 'direct', host };
}

// strips FiveM colour codes (^1, ~r~) and squashes whitespace
export function cleanName(name: string): string {
    return name
        .replace(/\^\d/g, '')
        .replace(/~[a-z]~/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// servers that hide players return placeholder names
function visible(players: Player[]): boolean {
    return players.length === 0 || players.some((p) => p.name && p.name !== 'Player');
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'statusbot (+https://discord.gg/agn)' },
        signal: AbortSignal.timeout(TIMEOUT),
    });

    const text = await res.text();
    let body: any = null;
    try {
        body = JSON.parse(text);
    } catch {
        // some servers answer with html error pages
    }

    return { status: res.status, body };
}

function offline(name: string): Snapshot {
    return { online: false, name, clients: 0, max: 0, players: [], playersVisible: false };
}

export function fromList(code: string, body: any, now = Date.now()): Snapshot {
    const data = body?.Data;
    if (!data) return offline(code);

    const lastSeen = Date.parse(data.lastSeen ?? '');
    const players: Player[] = (data.players ?? []).map((p: any) => ({
        id: Number(p.id) || 0,
        name: String(p.name ?? ''),
        ping: Number(p.ping) || 0,
    }));

    const vars = data.vars ?? {};
    const snapshot: Snapshot = {
        online: !Number.isNaN(lastSeen) && now - lastSeen < STALE_AFTER,
        name: cleanName(vars.sv_projectName || data.hostname || code),
        clients: Number(data.clients) || players.length,
        max: Number(data.sv_maxclients ?? data.svMaxclients ?? vars.sv_maxClients) || 0,
        players,
        playersVisible: visible(players),
        banner: vars.banner_detail || vars.banner_connecting || undefined,
        connect: `https://cfx.re/join/${code}`,
    };

    if (data.iconVersion !== undefined) {
        snapshot.icon = `https://frontend.cfx-services.net/api/servers/icon/${code}/${data.iconVersion}.png`;
    }

    if (!snapshot.online) {
        snapshot.clients = 0;
        snapshot.players = [];
    }

    return snapshot;
}

async function fetchList(code: string): Promise<Snapshot> {
    const { status, body } = await getJson(LIST_API + code);
    if (status === 404) return offline(code);
    if (status !== 200) throw new Error(`server list answered ${status}`);
    return fromList(code, body);
}

async function fetchDirect(host: string): Promise<Snapshot> {
    const base = `http://${host}`;
    const [info, dynamic, players] = await Promise.allSettled([
        getJson(`${base}/info.json`),
        getJson(`${base}/dynamic.json`),
        getJson(`${base}/players.json`),
    ]);

    const ok = (r: PromiseSettledResult<{ status: number; body: any }>) =>
        r.status === 'fulfilled' && r.value.status === 200 && r.value.body ? r.value.body : null;

    const infoBody = ok(info);
    const dyn = ok(dynamic);
    if (!infoBody && !dyn) return offline(host);

    // players.json is often switched off, so it's optional
    const list: Player[] = Array.isArray(ok(players))
        ? ok(players).map((p: any) => ({ id: Number(p.id) || 0, name: String(p.name ?? ''), ping: Number(p.ping) || 0 }))
        : [];

    const vars = infoBody?.vars ?? {};

    return {
        online: true,
        name: cleanName(vars.sv_projectName || dyn?.hostname || host),
        clients: Number(dyn?.clients) || list.length,
        max: Number(dyn?.sv_maxclients ?? vars.sv_maxClients) || 0,
        players: list,
        playersVisible: list.length > 0 && visible(list),
        banner: vars.banner_detail || vars.banner_connecting || undefined,
    };
}

export async function fetchServer(target: Target): Promise<Snapshot> {
    return target.kind === 'cfx' ? fetchList(target.code) : fetchDirect(target.host);
}
