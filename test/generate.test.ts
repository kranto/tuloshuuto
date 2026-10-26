import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { atomicWrite, fetchCalendar, generateCalendars } from '../src/generate.js';
import { publicUrl, validateConfig } from '../src/config.js';

const source = readFileSync(new URL('./fixtures/source.ics', import.meta.url), 'utf8');
const config = { pagesBaseUrl: 'https://kranto.github.io/tuloshuuto', teams: [
  { id: 'm50', prefix: 'M50', url: 'https://example.org/secret?token=private' },
] };
const success: typeof fetch = async () => new Response(source);

test('validated configuration, unique IDs and HTTPS URLs are required before fetching', async () => {
  const invalid = [null, {}, { ...config, teams: [] }, { ...config, pagesBaseUrl: 'http://example.org' },
    { ...config, pagesBaseUrl: 'https://example.org/?secret=a' },
    { ...config, pagesBaseUrl: 'https://example.org/?' },
    { ...config, pagesBaseUrl: 'https://example.org/#' },
    ...['M50', '../x', 'a/b', '', '.'].map(id => ({ ...config, teams: [{ ...config.teams[0], id }] })),
    { ...config, teams: [config.teams[0], config.teams[0]] },
    { ...config, teams: [{ ...config.teams[0], url: 'http://example.org' }] },
    { ...config, teams: [{ ...config.teams[0], prefix: '\n' }] }];
  for (const value of invalid) assert.throws(() => validateConfig(value));
  let called = false;
  await assert.rejects(generateCalendars(invalid[0] as never, { outputDir: '/unused', fetcher: async () => {
    called = true; return new Response(source);
  } }));
  assert.equal(called, false);
  assert.equal(publicUrl(config.pagesBaseUrl + '/', '7idv'), 'https://kranto.github.io/tuloshuuto/7idv.ics');
  assert.equal(publicUrl(config.pagesBaseUrl, '7idv'), 'https://kranto.github.io/tuloshuuto/7idv.ics');
});

test('successful generation is repeatable and leaves unchanged output untouched', async t => {
  const outputDir = await fs.mkdtemp(join(tmpdir(), 'tuloshuuto-'));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  const first = await generateCalendars(config, { outputDir, fetcher: success });
  assert.equal(first.status, 'success');
  assert.deepEqual(first.teams[0], { id: 'm50', prefix: 'M50', status: 'success', events: 1, changed: true, url: publicUrl(config.pagesBaseUrl, 'm50') });
  const before = await fs.stat(join(outputDir, 'm50.ics'));
  const second = await generateCalendars(config, { outputDir, fetcher: success });
  assert.equal(second.teams[0]!.changed, false);
  assert.equal((await fs.stat(join(outputDir, 'm50.ics'))).mtimeMs, before.mtimeMs);
  assert.notEqual(first.runId, second.runId);
  assert.deepEqual(await fs.readdir(outputDir), ['m50.ics']);
});

const failures: [string, typeof fetch][] = [
  ['network failure', async () => { throw new Error('https://example.org/secret?token=private'); }],
  ['HTTP error', async () => new Response('private body', { status: 403 })],
  ['empty body', async () => new Response(' \n')],
  ['HTML instead of ICS', async () => new Response('<html>private body</html>')],
  ['zero events', async () => new Response(source.replace(/BEGIN:VEVENT[\s\S]*END:VEVENT\n/, ''))],
  ['malformed event', async () => new Response(source.replace(/^UID:.*\n/m, ''))],
  ['broken component', async () => new Response(source.replace('END:VEVENT', 'END:VTODO'))],
  ['invalid UTF-8', async () => new Response(new Uint8Array([0xc3, 0x28]))],
];
for (const [name, fetcher] of failures) {
  test(`${name} preserves existing output and reports sanitized errors`, async t => {
    const outputDir = await fs.mkdtemp(join(tmpdir(), 'tuloshuuto-'));
    t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
    const path = join(outputDir, 'm50.ics');
    await fs.writeFile(path, 'previous calendar');
    const report = await generateCalendars(config, { outputDir, fetcher });
    assert.equal(report.status, 'failed');
    assert.equal(report.teams[0]!.status, 'failed');
    assert.equal(report.teams[0]!.events, null);
    assert.equal(report.teams[0]!.changed, null);
    assert.doesNotMatch(JSON.stringify(report), /private|token=|secret/);
    assert.equal(await fs.readFile(path, 'utf8'), 'previous calendar');
    assert.deepEqual(await fs.readdir(outputDir), ['m50.ics']);
  });
}

test('one invalid event fails the whole team, but other teams still generate', async t => {
  const outputDir = await fs.mkdtemp(join(tmpdir(), 'tuloshuuto-'));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  const teams = [...config.teams, { id: 'm45', prefix: 'M45', url: 'https://example.org/ok' }];
  const badEvent = source.slice(source.indexOf('BEGIN:VEVENT'), source.indexOf('END:VEVENT') + 10).replace(/^UID:.*\n/m, '');
  const fetcher: typeof fetch = async url => new Response(String(url).endsWith('/ok') ? source : source.replace('END:VCALENDAR', `${badEvent}\nEND:VCALENDAR`));
  await fs.writeFile(join(outputDir, 'm50.ics'), 'old');
  const report = await generateCalendars({ ...config, teams }, { outputDir, fetcher });
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.teams.map(team => team.status), ['failed', 'success']);
  assert.equal(await fs.readFile(join(outputDir, 'm50.ics'), 'utf8'), 'old');
  assert.match(await fs.readFile(join(outputDir, 'm45.ics'), 'utf8'), /SUMMARY:M45:/);
  const selected = await generateCalendars({ ...config, teams }, { outputDir, fetcher, teamId: 'm45' });
  assert.equal(selected.status, 'success');
  assert.equal(selected.teams.length, 1);
  await assert.rejects(generateCalendars(config, { outputDir, fetcher, teamId: 'missing' }), /not configured/);
});

test('write and rename failures preserve the destination and clean temporary files', async t => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'tuloshuuto-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'm50.ics');
  await fs.writeFile(path, 'old');
  for (const operation of ['writeFile', 'rename'] as const) {
    const io = { ...fs, [operation]: async () => { throw new Error('disk failure'); } };
    await assert.rejects(atomicWrite(path, 'new', io));
    assert.equal(await fs.readFile(path, 'utf8'), 'old');
    assert.deepEqual(await fs.readdir(directory), ['m50.ics']);
  }
});

test('unwritable output is reported as team failure', async t => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'tuloshuuto-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const outputDir = join(directory, 'file');
  await fs.writeFile(outputDir, 'blocking file');
  const report = await generateCalendars(config, { outputDir, fetcher: success });
  assert.equal(report.status, 'failed');
  assert.match(report.teams[0]!.error!, /file write failed/);
  assert.equal(await fs.readFile(outputDir, 'utf8'), 'blocking file');
});

for (const stage of ['headers', 'body']) {
  test(`download timeout covers stalled ${stage} using an actual local HTTP server`, async t => {
    const server = createServer((_req, res) => {
      if (stage === 'body') { res.writeHead(200, { 'Content-Type': 'text/calendar' }); res.write('BEGIN:VCALENDAR\r\n'); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const localFetch: typeof fetch = (_url, init) => fetch(`http://127.0.0.1:${address.port}`, init);
    await assert.rejects(fetchCalendar(config.teams[0]!.url, localFetch, 60), /timed out/);
  });
}
