import { readFileSync } from 'node:fs';
import { z } from 'zod';

const hex = z.string().regex(/^#?[0-9a-f]{6}$/i).transform((v) => parseInt(v.replace('#', ''), 16));

const server = z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/i, 'ids can only use letters, numbers, - and _'),
    address: z.string().min(1),
    channelId: z.string().regex(/^\d+$/),
    name: z.string().optional(),
    connect: z.string().url().optional(),
    discord: z.string().url().optional(),
    banner: z.union([z.string().url(), z.literal(false)]).optional(),
    alerts: z.object({
        channelId: z.string().regex(/^\d+$/),
        roleId: z.string().regex(/^\d+$/).optional(),
    }).optional(),
});

const schema = z.object({
    servers: z.array(server).min(1),
    guildId: z.string().regex(/^\d+$/).optional(),
    interval: z.number().int().min(15).default(60),
    failuresBeforeOffline: z.number().int().min(1).default(3),
    colors: z.object({
        online: hex.default('#2BD9CC'),
        offline: hex.default('#E5484D'),
    }).default({}),
});

export type ServerConfig = z.infer<typeof server>;
export type Config = z.infer<typeof schema>;

export function loadConfig(path = 'config.json'): Config {
    let raw: unknown;

    try {
        raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
        throw new Error(`Couldn't read ${path}. Copy config.example.json to config.json and fill it in. (${(err as Error).message})`);
    }

    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
        throw new Error(`config.json has problems:\n${issues}`);
    }

    const ids = new Set<string>();
    for (const s of parsed.data.servers) {
        if (ids.has(s.id)) throw new Error(`config.json: server id "${s.id}" is used twice`);
        ids.add(s.id);
    }

    return parsed.data;
}
