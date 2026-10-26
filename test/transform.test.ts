import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ICAL from 'ical.js';
import { parseCalendar, transformCalendar } from '../src/transform.js';

const source = readFileSync(new URL('./fixtures/source.ics', import.meta.url), 'utf8');
const event = (ics: string) => parseCalendar(ics).getFirstSubcomponent('vevent')!;
const value = (ics: string, name: string) => event(ics).getFirstPropertyValue(name);

test('transforms title and description while preserving metadata and every other event property', () => {
  const output = transformCalendar(source, 'M50');
  assert.equal(value(output, 'summary'), 'M50: KaVo – Soho Seniors');
  assert.equal(value(output, 'description'), 'Harjuniitty, Lautamiehenkatu 1, Nokia\nhttps://tulospalvelu.palloliitto.fi/match/4402981');
  assert.match(output, /DESCRIPTION:Harjuniitty\\, Lautamiehenkatu 1\\, Nokia\\n/);
  const before = parseCalendar(source);
  const after = parseCalendar(output);
  assert.deepEqual(after.jCal[1], before.jCal[1]);
  const otherProperties = (component: ICAL.Component) => component.jCal[1].filter((property: string[]) => !['summary', 'description'].includes(property[0]!));
  assert.deepEqual(otherProperties(event(output)), otherProperties(event(source)));
});

test('idempotent conversion does not duplicate prefixes or locations', () => {
  const once = transformCalendar(source, 'M50');
  assert.equal(transformCalendar(once, 'M50'), once);
});

test('only matching category suffixes are removed; team spellings remain unchanged', () => {
  const mismatch = source.replace('CATEGORIES:Miehet 50 Futsal-Ykkönen', 'CATEGORIES:Other');
  assert.equal(value(transformCalendar(mismatch, '7IDV'), 'summary'), '7IDV: KaVo – Soho Seniors, Miehet 50 Futsal-Ykkönen');
  const missing = source.replace(/^CATEGORIES:.*\n/m, '');
  assert.equal(value(transformCalendar(missing, 'M45'), 'summary'), 'M45: KaVo – Soho Seniors, Miehet 50 Futsal-Ykkönen');
});

test('multiple categories use the longest matching suffix at most once, including on repeat', () => {
  const multi = source.replace('CATEGORIES:Miehet 50 Futsal-Ykkönen',
    'CATEGORIES:Other,League\nCATEGORIES:Cup\\, League')
    .replace(/^SUMMARY:.*$/m, 'SUMMARY:Home – Away\\, Other\\, Cup\\, League');
  const once = transformCalendar(multi, 'M50');
  assert.equal(value(once, 'summary'), 'M50: Home – Away, Other');
  assert.equal(transformCalendar(once, 'M50'), once);
});

test('missing/empty location leaves description alone; missing/empty description becomes location alone', () => {
  for (const replacement of ['', 'LOCATION:\n', 'LOCATION:  \n']) {
    const input = source.replace(/^LOCATION:.*\n/m, replacement);
    assert.equal(value(transformCalendar(input, 'M50'), 'description'), value(source, 'description'));
  }
  for (const replacement of ['', 'DESCRIPTION:\n']) {
    const input = source.replace(/^DESCRIPTION:.*\n/m, replacement);
    assert.equal(value(transformCalendar(input, 'M50'), 'description'), value(source, 'location'));
  }
  const neither = source.replace(/^(?:LOCATION|DESCRIPTION):.*\n/gm, '');
  assert.equal(event(transformCalendar(neither, 'M50')).hasProperty('description'), false);
});

test('exact location-prefix matching and complete original description preservation', () => {
  const calendar = parseCalendar(source);
  const match = calendar.getFirstSubcomponent('vevent')!;
  const location = match.getFirstPropertyValue('location') as string;
  for (const description of [location, `${location}\nAlready present`, `${location} elsewhere`, `See ${location}`, '\nOriginal\n\ntext']) {
    match.updatePropertyWithValue('description', description);
    const output = transformCalendar(ICAL.stringify(calendar.jCal), 'M50');
    const expected = description === location || description.startsWith(`${location}\n`) ? description : `${location}\n${description}`;
    assert.equal(value(output, 'description'), expected);
    assert.equal(transformCalendar(output, 'M50'), output);
  }
});

test('commas, semicolons, backslashes, newlines and UTF-8 folding round-trip', () => {
  const calendar = parseCalendar(source);
  const match = calendar.getFirstSubcomponent('vevent')!;
  const location = 'Kenttä, katu; polku\\nimi ' + 'Ää😀'.repeat(60);
  const description = 'Original, text; backslash\\\nNext line';
  match.updatePropertyWithValue('location', location);
  match.updatePropertyWithValue('description', description);
  const output = transformCalendar(ICAL.stringify(calendar.jCal), 'M50');
  assert.equal(value(output, 'description'), `${location}\n${description}`);
  assert.match(output, /\\;/);
  assert.match(output, /\\\\/);
  assert.ok(!output.replaceAll('\r\n', '').includes('\n'));
  for (const line of output.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(output)), output);
});

test('unfolds source lines and processes every event', () => {
  const folded = source.replace('Soho Seniors\\,', 'Soho \n Seniors\\,');
  const vevent = folded.slice(folded.indexOf('BEGIN:VEVENT'), folded.indexOf('END:VEVENT') + 'END:VEVENT'.length)
    .replace('4402981@spl', '4402982@spl');
  const output = transformCalendar(folded.replace('END:VCALENDAR', `${vevent}\nEND:VCALENDAR`), 'M50');
  const events = parseCalendar(output).getAllSubcomponents('vevent');
  assert.equal(events.length, 2);
  for (const match of events) assert.equal(match.getFirstPropertyValue('summary'), 'M50: KaVo – Soho Seniors');
});

test('preserves timezone definitions, TZID, unknown/repeated properties, parameters and alarms', () => {
  const timezone = 'BEGIN:VTIMEZONE\nTZID:Europe/Helsinki\nBEGIN:STANDARD\nDTSTART:19701025T040000\nTZOFFSETFROM:+0300\nTZOFFSETTO:+0200\nEND:STANDARD\nEND:VTIMEZONE\n';
  const alarm = 'BEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT30M\nDESCRIPTION:Muistutus\nEND:VALARM\n';
  const input = source.replace('BEGIN:VEVENT', timezone + 'BEGIN:VEVENT')
    .replace('DTSTART:20261205T162000Z', 'DTSTART;TZID=Europe/Helsinki:20261205T182000')
    .replace('END:VEVENT', `X-CUSTOM;X-PARAM="a:b":one\nX-CUSTOM:two\n${alarm}END:VEVENT`);
  const before = parseCalendar(input);
  const after = parseCalendar(transformCalendar(input, 'M50'));
  assert.deepEqual(after.getAllSubcomponents('vtimezone').map(c => c.jCal), before.getAllSubcomponents('vtimezone').map(c => c.jCal));
  const a = after.getFirstSubcomponent('vevent')!;
  const b = before.getFirstSubcomponent('vevent')!;
  assert.deepEqual(a.getFirstProperty('dtstart')!.jCal, b.getFirstProperty('dtstart')!.jCal);
  assert.deepEqual(a.getAllProperties('x-custom').map(p => p.jCal), b.getAllProperties('x-custom').map(p => p.jCal));
  assert.deepEqual(a.getAllSubcomponents().map(c => c.jCal), b.getAllSubcomponents().map(c => c.jCal));
});

test('rejects malformed documents, empty calendars, invalid dates and missing required event fields', () => {
  const invalid = ['', '<html>failure</html>', 'BEGIN:VCALENDAR\nEND:VCALENDAR',
    source.replace(/BEGIN:VEVENT[\s\S]*END:VEVENT\n/, ''),
    source.replace('END:VEVENT', 'END:VTODO'), source.replace('END:VCALENDAR', ''),
    source + 'unexpected', source + source,
    source.replace('20261205T162000Z', '20261335T256100Z'),
    source.replace('20261205T171000Z', '20260230T171000Z'),
    source.replace('20261205T162000Z', '20261205T162000Zgarbage'),
    ...['UID', 'SUMMARY', 'DTSTAMP', 'DTSTART'].map(name => source.replace(new RegExp(`^${name}:.*\\n`, 'm'), '')),
    source.replace('SUMMARY:', 'SUMMARY:Duplicate\nSUMMARY:'),
    source.replace('LOCATION:', 'LOCATION:Duplicate\nLOCATION:')];
  for (const input of invalid) assert.throws(() => transformCalendar(input, 'M50'));
});

test('date-only events and missing optional DTEND retain their meaning', () => {
  const input = source.replace('DTSTART:20261205T162000Z', 'DTSTART;VALUE=DATE:20261205')
    .replace(/^DTEND:.*\n/m, '');
  const output = transformCalendar(input, 'M50');
  assert.deepEqual(event(output).getFirstProperty('dtstart')!.jCal, event(input).getFirstProperty('dtstart')!.jCal);
  assert.equal(event(output).hasProperty('dtend'), false);
});
