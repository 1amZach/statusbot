import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanName, fetchServer, fromList, parseAddress } from '../src/fivem.ts';
import { bar, playerPage } from '../src/panel.ts';
import { initial, next } from '../src/status.ts';
import type { Snapshot } from '../src/fivem.ts';

test('parses join links, codes and ip:port', () => {
    assert.deepEqual(parseAddress('https://cfx.re/join/AbC123'), { kind: 'cfx', code: 'abc123' });
    assert.deepEqual(parseAddress('cfx.re/join/abc123/'), { kind: 'cfx', code: 'abc123' });
    assert.deepEqual(parseAddress('abc123'), { kind: 'cfx', code: 'abc123' });
    assert.deepEqual(parseAddress('127.0.0.1:30120'), { kind: 'direct', host: '127.0.0.1:30120' });
    assert.deepEqual(parseAddress('http://play.example.com:30120/'), { kind: 'direct', host: 'play.example.com:30120' });
    assert.throws(() => parseAddress('not a server'));
});

test('strips colour codes from names', () => {
    assert.equal(cleanName('^1Red ^7Server  ~b~RP'), 'Red Server RP');
});

test('player bar', () => {
    assert.equal(bar(0, 64, 4), '▱▱▱▱');
    assert.equal(bar(32, 64, 4), '▰▰▱▱');
    assert.equal(bar(80, 64, 4), '▰▰▰▰');
    assert.equal(bar(5, 0, 4), '▱▱▱▱');
});

const now = Date.parse('2026-10-30T12:00:00Z');
const listBody = (lastSeen: string, players = [{ id: 1, name: 'Zach', ping: 40 }]) => ({
    Data: {
        hostname: '^2Astra', clients: players.length, sv_maxclients: 64, lastSeen, players,
        vars: { sv_projectName: 'Astra Gaming Network', banner_detail: 'https://example.com/b.png' },
        iconVersion: 7,
    },
});

test('server list: fresh entry is online', () => {
    const s = fromList('abc123', listBody('2026-10-30T11:59:00Z'), now);
    assert.equal(s.online, true);
    assert.equal(s.name, 'Astra Gaming Network');
    assert.equal(s.clients, 1);
    assert.equal(s.max, 64);
    assert.equal(s.playersVisible, true);
    assert.equal(s.connect, 'https://cfx.re/join/abc123');
    assert.match(s.icon!, /icon\/abc123\/7\.png$/);
});

test('server list: stale entry counts as offline with no players', () => {
    const s = fromList('abc123', listBody('2026-10-30T11:40:00Z'), now);
    assert.equal(s.online, false);
    assert.equal(s.clients, 0);
    assert.equal(s.players.length, 0);
});

test('server list: hidden player list is detected', () => {
    const s = fromList('abc123', listBody('2026-10-30T11:59:00Z', [{ id: 0, name: 'Player', ping: 0 }]), now);
    assert.equal(s.playersVisible, false);
});

const up = (clients = 10): Snapshot => ({ online: true, name: 'x', clients, max: 64, players: [], playersVisible: true });

test('first poll never alerts', () => {
    assert.equal(next(initial(now), up(), now, 3).change, null);
    assert.equal(next(initial(now), null, now, 3).change, null);
});

test('goes offline only after enough failures in a row', () => {
    let s = next(initial(now), up(), now, 3).status;
    let r = next(s, null, now + 60e3, 3); assert.equal(r.change, null); s = r.status;
    r = next(s, null, now + 120e3, 3); assert.equal(r.change, null); s = r.status;
    r = next(s, null, now + 180e3, 3); assert.equal(r.change, 'offline'); s = r.status;
    assert.equal(s.online, false);
    assert.equal(s.since, now + 180e3);
    r = next(s, null, now + 240e3, 3); assert.equal(r.change, null, 'no repeat alert while still down');
});

test('one blip in the middle resets the failure count', () => {
    let s = next(initial(now), up(), now, 2).status;
    s = next(s, null, now + 1, 2).status;
    s = next(s, up(), now + 2, 2).status;
    const r = next(s, null, now + 3, 2);
    assert.equal(r.change, null);
});

test('comes back online with an alert and tracks the daily peak', () => {
    let s = next(initial(now), up(5), now, 1).status;
    s = next(s, null, now + 1, 1).status;
    const r = next(s, up(12), now + 2, 1);
    assert.equal(r.change, 'online');
    assert.equal(r.status.peak, 12);
    const tomorrow = next(r.status, up(3), now + 24 * 3600e3, 1);
    assert.equal(tomorrow.status.peak, 3, 'peak resets on a new day');
});

test('player list pages and escapes names', () => {
    const players = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, name: i === 0 ? '@everyone *bold*' : `P${i + 1}`, ping: 30 }));
    const status = { ...initial(now), online: true, checked: now, last: { ...up(45), players } };
    const server = { id: 'main', address: 'abc123', channelId: '1' };
    const config = { servers: [server], interval: 60, failuresBeforeOffline: 3, colors: { online: 1, offline: 2 } };

    const first = playerPage(server, status, 0, config);
    const text = first.embeds[0]!.data.description!;
    assert.ok(text.includes('@​everyone'), 'mentions are defused');
    assert.ok(text.includes('\\*bold\\*'), 'markdown is escaped');
    assert.equal(first.components.length, 1, 'has paging buttons');

    const last = playerPage(server, status, 99, config);
    assert.match(last.embeds[0]!.data.footer!.text, /page 3 of 3/);
});

test('live: a real server from the Cfx list', { skip: !process.env.LIVE }, async () => {
    const s = await fetchServer(parseAddress(process.env.LIVE!));
    assert.equal(typeof s.online, 'boolean');
    console.log(`  ${s.name}: ${s.online ? 'online' : 'offline'} ${s.clients}/${s.max}, players visible: ${s.playersVisible}`);
});

test('live: unreachable direct server reads as offline', { skip: !process.env.LIVE }, async () => {
    const s = await fetchServer(parseAddress('127.0.0.1:1'));
    assert.equal(s.online, false);
});
