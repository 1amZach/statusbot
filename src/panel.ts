import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { Config, ServerConfig } from './config.js';
import type { Player } from './fivem.js';
import type { Status } from './status.js';

const unix = (ms: number) => Math.floor(ms / 1000);

export function bar(value: number, max: number, width = 12): string {
    if (max <= 0) return '▱'.repeat(width);
    const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
    return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

export function displayName(server: ServerConfig, status: Status): string {
    return server.name ?? status.last?.name ?? server.id;
}

export function connectUrl(server: ServerConfig, status: Status): string | undefined {
    return server.connect ?? status.last?.connect;
}

export function panel(server: ServerConfig, status: Status, config: Config) {
    const snap = status.last;
    const name = displayName(server, status);
    const embed = new EmbedBuilder()
        .setTitle(name)
        .setColor(status.online ? config.colors.online : config.colors.offline)
        .setFooter({ text: `Updates every ${config.interval}s` })
        .setTimestamp(status.checked || Date.now());

    const url = connectUrl(server, status);
    if (url) embed.setURL(url);

    if (status.online && snap) {
        embed.setDescription(`**Online** · up since <t:${unix(status.since)}:R>`);
        embed.addFields(
            { name: 'Players', value: `**${snap.clients}** / ${snap.max}\n\`${bar(snap.clients, snap.max)}\``, inline: true },
            { name: 'Peak today', value: `**${status.peak}**`, inline: true },
        );
    } else if (status.checked === 0) {
        embed.setDescription('Checking...');
    } else {
        embed.setDescription(`**Offline** since <t:${unix(status.since)}:R>`);
    }

    const banner = server.banner === false ? undefined : server.banner ?? snap?.banner;
    if (banner) embed.setImage(banner);
    if (snap?.icon) embed.setThumbnail(snap.icon);

    const row = new ActionRowBuilder<ButtonBuilder>();

    if (url) {
        row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Connect').setURL(url));
    }

    row.addComponents(
        new ButtonBuilder()
            .setStyle(ButtonStyle.Secondary)
            .setLabel('Players')
            .setCustomId(`players:${server.id}:0`)
            .setDisabled(!status.online),
    );

    if (server.discord) {
        row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Discord').setURL(server.discord));
    }

    return { embeds: [embed], components: [row] };
}

const PAGE = 20;

export function playerPage(server: ServerConfig, status: Status, page: number, config: Config) {
    const snap = status.last;
    const embed = new EmbedBuilder()
        .setTitle(`Players on ${displayName(server, status)}`)
        .setColor(config.colors.online);

    if (!status.online || !snap) {
        embed.setColor(config.colors.offline).setDescription('The server is offline.');
        return { embeds: [embed], components: [] };
    }

    if (!snap.playersVisible) {
        embed.setDescription(`**${snap.clients}** / ${snap.max} online. This server keeps its player list private.`);
        return { embeds: [embed], components: [] };
    }

    if (snap.players.length === 0) {
        embed.setDescription('Nobody is on right now.');
        return { embeds: [embed], components: [] };
    }

    const sorted = [...snap.players].sort((a, b) => a.id - b.id);
    const pages = Math.ceil(sorted.length / PAGE);
    const current = Math.max(0, Math.min(page, pages - 1));
    const slice = sorted.slice(current * PAGE, current * PAGE + PAGE);

    embed
        .setDescription(slice.map((p: Player) => `\`${String(p.id).padStart(3, ' ')}\` ${escape(p.name)} · ${p.ping}ms`).join('\n'))
        .setFooter({ text: `${snap.clients} / ${snap.max} online · page ${current + 1} of ${pages}` });

    if (pages === 1) return { embeds: [embed], components: [] };

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`players:${server.id}:${current - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
        new ButtonBuilder().setCustomId(`players:${server.id}:${current + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1),
    );

    return { embeds: [embed], components: [row] };
}

// stop player names from breaking markdown or pinging people
function escape(name: string): string {
    return name.replace(/([*_`~|>\\])/g, '\\$1').replace(/@/g, '@\u200b').slice(0, 64) || 'unnamed';
}

export function alert(server: ServerConfig, status: Status, change: 'online' | 'offline', config: Config) {
    const name = displayName(server, status);
    const embed = new EmbedBuilder()
        .setColor(change === 'online' ? config.colors.online : config.colors.offline)
        .setTitle(change === 'online' ? `${name} is back online` : `${name} went offline`)
        .setTimestamp(status.since);

    const role = server.alerts?.roleId;
    return {
        content: role ? `<@&${role}>` : undefined,
        embeds: [embed],
        allowedMentions: { roles: role ? [role] : [] },
    };
}
