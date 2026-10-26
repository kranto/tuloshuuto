import ICAL from 'ical.js';
import { isDeepStrictEqual } from 'node:util';
import { SafeError } from './errors.js';

/** The parser is permissive about framing, so check it before handing over values. */
function checkStructure(input: string): string {
  const normalized = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.trim() || /[\x00-\x08\x0b-\x1f\x7f]/.test(normalized)) {
    throw new SafeError('Invalid ICS content.');
  }
  const lines = normalized.replace(/\n[ \t]/g, '').split('\n');
  const stack: string[] = [];
  let roots = 0;
  let ended = false;
  for (const line of lines) {
    if (!line && (roots === 0 || ended)) continue;
    const boundary = /^(BEGIN|END):([A-Z0-9-]+)$/i.exec(line);
    if (boundary) {
      const name = boundary[2]!.toLowerCase();
      if (boundary[1]!.toUpperCase() === 'BEGIN') {
        if (ended || (!stack.length && (roots++ > 0 || name !== 'vcalendar')) ||
            (name === 'vcalendar' && stack.length > 0) ||
            (name === 'vevent' && (stack.length !== 1 || stack[0] !== 'vcalendar'))) {
          throw new SafeError('Invalid ICS component structure.');
        }
        stack.push(name);
      } else {
        if (stack.pop() !== name) throw new SafeError('Invalid ICS component structure.');
        ended = stack.length === 0;
      }
    } else {
      if (!stack.length || !/^[A-Z0-9-]+(?:;[^\n]*)?:/i.test(line)) {
        throw new SafeError('Invalid ICS content line.');
      }
      // The library slices date strings permissively. Reject truncated/trailing
      // garbage before parsing, including when a quoted TZID contains a colon.
      if (/^(DTSTART|DTEND|DTSTAMP)(?:;|:)/i.test(line)) {
        let quoted = false;
        let separator = -1;
        for (let index = 0; index < line.length; index++) {
          if (line[index] === '"') quoted = !quoted;
          if (line[index] === ':' && !quoted) { separator = index; break; }
        }
        if (separator < 0 || !/^\d{8}(?:T\d{6}Z?)?$/.test(line.slice(separator + 1))) {
          throw new SafeError('Invalid event date or time.');
        }
      }
    }
  }
  if (roots !== 1 || !ended || stack.length) throw new SafeError('Incomplete ICS calendar.');
  return normalized;
}

function single(component: ICAL.Component, name: string, required = false): ICAL.Property | undefined {
  const properties = component.getAllProperties(name);
  if (properties.length > 1 || (required && properties.length !== 1)) {
    throw new SafeError(`Missing or repeated ${name.toUpperCase()} property.`);
  }
  return properties[0];
}

function text(property: ICAL.Property | undefined, required = false): string {
  if (!property) return '';
  const value: unknown = property.jCal[3];
  if (property.type !== 'text' || property.jCal.length !== 4 || typeof value !== 'string' ||
      (required && !value.trim())) {
    throw new SafeError('Invalid text property in ICS calendar.');
  }
  return value.replace(/\r\n?/g, '\n');
}

function validateDate(property: ICAL.Property | undefined, utcOnly = false): void {
  if (!property) return;
  const value: unknown = property.jCal[3];
  if (typeof value !== 'string' || property.jCal.length !== 4 ||
      !['date', 'date-time'].includes(property.type)) throw new SafeError('Invalid event date or time.');
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(Z)?)?$/.exec(value);
  if (!match || (property.type === 'date') !== (match[4] === undefined) ||
      (utcOnly && (property.type !== 'date-time' || !match[7])) ||
      (match[7] && property.getParameter('tzid'))) throw new SafeError('Invalid event date or time.');
  const [, year, month, day, hour, minute, second] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days ||
      Number(hour ?? 0) > 23 || Number(minute ?? 0) > 59 || Number(second ?? 0) > 60) {
    throw new SafeError('Invalid event date or time.');
  }
}

export function parseCalendar(input: string): ICAL.Component {
  try {
    const calendar = new ICAL.Component(ICAL.parse(checkStructure(input)));
    const version = single(calendar, 'version', true);
    if (text(version, true) !== '2.0') throw new SafeError('ICS VERSION must be 2.0.');
    text(single(calendar, 'prodid', true), true);
    const events = calendar.getAllSubcomponents('vevent');
    if (!events.length) throw new SafeError('Source calendar contains zero events. Previous calendar file was preserved.');
    for (const event of events) {
      text(single(event, 'uid', true), true);
      text(single(event, 'summary', true), true);
      text(single(event, 'description'));
      text(single(event, 'location'));
      validateDate(single(event, 'dtstamp', true), true);
      validateDate(single(event, 'dtstart', true));
      validateDate(single(event, 'dtend'));
      for (const category of event.getAllProperties('categories')) {
        if (category.type !== 'text' || category.jCal.slice(3).some((value: unknown) => typeof value !== 'string')) {
          throw new SafeError('Invalid CATEGORIES property.');
        }
      }
    }
    return calendar;
  } catch (error) {
    if (error instanceof SafeError) throw error;
    // Library errors may quote source content, including private URLs.
    throw new SafeError('Invalid ICS content.');
  }
}

/** Fold by UTF-8 octets, including the continuation space in the 75-octet limit. */
function foldLine(line: string): string {
  let output = '';
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > 75) { output += '\r\n '; bytes = 1; }
    output += character;
    bytes += size;
  }
  return output;
}

export function transformCalendar(icsContent: string, teamPrefix: string): string {
  if (!teamPrefix.trim() || /[\x00-\x1f\x7f]/.test(teamPrefix)) throw new SafeError('Invalid team prefix.');
  const calendar = parseCalendar(icsContent);
  for (const event of calendar.getAllSubcomponents('vevent')) {
    const summary = event.getFirstProperty('summary')!;
    let title = text(summary);
    const prefix = `${teamPrefix}: `;
    if (!title.startsWith(prefix)) {
      const categories = event.getAllProperties('categories')
        .flatMap(property => property.jCal.slice(3) as string[])
        .filter(Boolean).sort((a, b) => b.length - a.length);
      const category = categories.find(value => title.endsWith(`, ${value}`));
      if (category) title = title.slice(0, -category.length - 2);
      summary.setValue(prefix + title);
    }
    const location = text(event.getFirstProperty('location') ?? undefined);
    const description = text(event.getFirstProperty('description') ?? undefined);
    if (location.trim() && description !== location && !description.startsWith(`${location}\n`)) {
      event.updatePropertyWithValue('description', description ? `${location}\n${description}` : location);
    }
  }
  // Re-fold the library output to account for the continuation-space octet.
  const output = ICAL.stringify(calendar.jCal).replace(/\r\n[ \t]/g, '')
    .split('\r\n').map(foldLine).join('\r\n');
  const validated = parseCalendar(output);
  if (!isDeepStrictEqual(calendar.jCal, validated.jCal)) {
    throw new SafeError('Generated ICS did not preserve calendar properties.');
  }
  return output;
}
