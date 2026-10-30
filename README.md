# statusbot

A Discord bot that keeps a live status panel for your FiveM server.

- One panel per server that the bot keeps editing, so the channel never fills up. If someone deletes it, the bot posts a new one.
- Shows online or offline, players with a fill bar, today's peak, how long it's been up or down, your banner and icon, and Connect, Players and Discord buttons.
- Posts an alert (with an optional role ping) when the server goes down or comes back. It waits for a few failed checks in a row first, so one slow answer doesn't spam the channel.
- The bot's own status shows the player count, or "server offline".
- `/status`, `/players` and `/connect`. The player list is private to whoever asked and pages 20 at a time.
- Watch as many servers as you like from one bot.

It reads from the Cfx server list when you give it a join link, so it works even if your server has `players.json` turned off. You can also point it straight at `ip:port`.

## Setup

You need Node 22 or newer.

1. Create a bot at the [Discord developer portal](https://discord.com/developers/applications), copy its token, and invite it with the `bot` and `applications.commands` scopes. It needs **View Channel**, **Send Messages**, **Embed Links** and **Read Message History** in the status channel.
2. Install and configure:

```bash
npm install
cp .env.example .env
cp config.example.json config.json
```

3. Put the token in `.env` and your server in `config.json`, then:

```bash
npm run build
npm start
```

### Docker

```bash
docker build -t statusbot .
docker run -d --name statusbot --restart unless-stopped \
  -e DISCORD_TOKEN=your-token \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/data:/app/data \
  statusbot
```

The `data` folder keeps the panel message ids and uptime between restarts.

## Config

| Key | | |
|---|---|---|
| `servers[].id` | required | Short name used internally, letters/numbers/`-`/`_` |
| `servers[].address` | required | `cfx.re/join/abc123`, just `abc123`, or `ip:port` |
| `servers[].channelId` | required | Channel for the status panel |
| `servers[].name` | | Overrides the name from the server |
| `servers[].connect` | | Connect button link. Filled in automatically for join codes |
| `servers[].discord` | | Adds a Discord button |
| `servers[].banner` | | Image URL, or `false` to hide the server's own banner |
| `servers[].alerts.channelId` | | Where up/down alerts go |
| `servers[].alerts.roleId` | | Role to ping with alerts |
| `guildId` | | Registers slash commands to this server instantly. Without it they're global, which can take up to an hour the first time |
| `interval` | `60` | Seconds between checks (minimum 15) |
| `failuresBeforeOffline` | `3` | Failed checks in a row before it counts as down |
| `colors.online` / `colors.offline` | `#2BD9CC` / `#E5484D` | Embed colours |

To get channel and role ids, turn on Developer Mode in Discord (Settings, Advanced) and right click → Copy ID.

## Development

```bash
npm run dev        # run from source
npm test           # unit tests
LIVE=abc123 npm test   # also checks a real server by join code
```

## Support

Made by **IamZach**. Questions, bugs or ideas: [discord.gg/agn](https://discord.gg/agn)

## License

MIT
