import {
    ActivityType,
    ChannelType,
    Client,
    DiscordAPIError,
    Events,
    GatewayIntentBits,
    type Interaction,
    type Message,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { loadConfig, type ServerConfig } from './config.js';
import { fetchServer, parseAddress, type Target } from './fivem.js';
import { alert, connectUrl, displayName, panel, playerPage } from './panel.js';
import { initial, next } from './status.js';
import { load, save } from './store.js';

const config = loadConfig();
const token = process.env.DISCORD_TOKEN;

if (!token) {
    console.error('DISCORD_TOKEN is missing. Put it in .env (see .env.example).');
    process.exit(1);
}

const targets = new Map<string, Target>(config.servers.map((s) => [s.id, parseAddress(s.address)]));
const state = load();
const now = Date.now();
for (const s of config.servers) state.status[s.id] ??= initial(now);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---------------------------------------------------------------- panel

async function textChannel(id: string) {
    const channel = await client.channels.fetch(id).catch(() => null);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
        return null;
    }
    return channel;
}

async function updatePanel(server: ServerConfig): Promise<void> {
    const channel = await textChannel(server.channelId);
    if (!channel) {
        console.warn(`[${server.id}] can't find text channel ${server.channelId}, or the bot can't see it`);
        return;
    }

    const body = panel(server, state.status[server.id]!, config);
    const known = state.messages[server.id];

    if (known) {
        try {
            const message = await channel.messages.fetch(known);
            await message.edit(body);
            return;
        } catch (err) {
            // 10008 = unknown message, someone deleted the panel. Anything else, try again next tick.
            if (!(err instanceof DiscordAPIError && err.code === 10008)) {
                console.warn(`[${server.id}] couldn't edit the panel:`, (err as Error).message);
                return;
            }
        }
    }

    try {
        const message: Message = await channel.send(body);
        state.messages[server.id] = message.id;
        save(state);
    } catch (err) {
        console.warn(`[${server.id}] couldn't post the panel:`, (err as Error).message);
    }
}

// ---------------------------------------------------------------- polling

async function poll(server: ServerConfig): Promise<void> {
    let snapshot = null;

    try {
        snapshot = await fetchServer(targets.get(server.id)!);
    } catch (err) {
        console.warn(`[${server.id}] check failed:`, (err as Error).message);
    }

    const { status, change } = next(state.status[server.id]!, snapshot, Date.now(), config.failuresBeforeOffline);
    state.status[server.id] = status;

    if (change) {
        console.log(`[${server.id}] ${change}`);

        if (server.alerts) {
            const channel = await textChannel(server.alerts.channelId);
            await channel?.send(alert(server, status, change, config)).catch((err) =>
                console.warn(`[${server.id}] couldn't send alert:`, err.message));
        }
    }

    await updatePanel(server);
}

let presenceIndex = 0;

function updatePresence(): void {
    const server = config.servers[presenceIndex++ % config.servers.length]!;
    const status = state.status[server.id]!;
    const multi = config.servers.length > 1 ? ` · ${displayName(server, status)}` : '';

    client.user?.setPresence({
        status: status.online ? 'online' : 'dnd',
        activities: [{
            type: ActivityType.Watching,
            name: status.online && status.last
                ? `${status.last.clients}/${status.last.max} players${multi}`
                : `server offline${multi}`,
        }],
    });
}

async function tick(): Promise<void> {
    await Promise.allSettled(config.servers.map(poll));
    save(state);
    updatePresence();
}

// ---------------------------------------------------------------- commands

function serverOption(builder: SlashCommandBuilder) {
    return builder.addStringOption((o) => {
        o.setName('server').setDescription('Which server').setRequired(false);
        for (const s of config.servers.slice(0, 25)) {
            o.addChoices({ name: displayName(s, state.status[s.id]!).slice(0, 100), value: s.id });
        }
        return o;
    });
}

const commands = [
    serverOption(new SlashCommandBuilder().setName('status').setDescription('Show the server status')),
    serverOption(new SlashCommandBuilder().setName('players').setDescription('See who\'s online')),
    serverOption(new SlashCommandBuilder().setName('connect').setDescription('Get the link to join')),
];

function pick(id: string | null): ServerConfig {
    return config.servers.find((s) => s.id === id) ?? config.servers[0]!;
}

async function handle(interaction: Interaction): Promise<void> {
    if (interaction.isButton() && interaction.customId.startsWith('players:')) {
        const [, id, page] = interaction.customId.split(':');
        const server = pick(id ?? null);
        const body = playerPage(server, state.status[server.id]!, Number(page) || 0, config);

        // the button on the public panel opens a private list, the arrows inside it page in place
        if (interaction.message.flags.has('Ephemeral')) {
            await interaction.update(body);
        } else {
            await interaction.reply({ ...body, flags: MessageFlags.Ephemeral });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const server = pick(interaction.options.getString('server'));
    const status = state.status[server.id]!;

    switch (interaction.commandName) {
        case 'status': {
            const body = panel(server, status, config);
            await interaction.reply({ ...body, flags: MessageFlags.Ephemeral });
            break;
        }
        case 'players':
            await interaction.reply({ ...playerPage(server, status, 0, config), flags: MessageFlags.Ephemeral });
            break;
        case 'connect': {
            const url = connectUrl(server, status);
            await interaction.reply({
                content: url ? `Join **${displayName(server, status)}**: ${url}` : 'No connect link is set for this server.',
                flags: MessageFlags.Ephemeral,
            });
            break;
        }
    }
}

// ---------------------------------------------------------------- start

client.once(Events.ClientReady, async (ready) => {
    console.log(`Logged in as ${ready.user.tag}, watching ${config.servers.length} server(s)`);

    const body = commands.map((c) => c.toJSON());
    try {
        if (config.guildId) {
            await ready.application.commands.set(body, config.guildId);
        } else {
            // global commands can take a while to show up the first time
            await ready.application.commands.set(body);
        }
    } catch (err) {
        console.warn('couldn\'t register slash commands:', (err as Error).message);
    }

    await tick();
    setInterval(() => void tick(), config.interval * 1000);
});

client.on(Events.InteractionCreate, (interaction) => {
    handle(interaction).catch((err) => console.warn('interaction failed:', err.message));
});

process.on('SIGINT', () => {
    save(state);
    process.exit(0);
});

client.login(token);
