// JARVIS: a small iCalendar (RFC 5545) reader for the Google Calendar panel.
// Enough for what Google exports: single and all-day events, the common
// recurrence rules (daily, weekly, monthly, yearly with INTERVAL, COUNT, UNTIL,
// BYDAY, BYMONTHDAY), EXDATE, moved or cancelled instances (RECURRENCE-ID).
//
// Times with a TZID are read as local time: right for a calendar in the PC's
// own time zone, which is the case this panel is for.

export interface CalEvent {
  id: string;
  title: string;
  location: string;
  start: Date;
  end: Date;
  allDay: boolean;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface Raw {
  uid: string;
  title: string;
  location: string;
  start: Date;
  end: Date;
  allDay: boolean;
  rrule: Record<string, string> | null;
  exdates: Set<number>;
  recurrenceId: number | null;
  cancelled: boolean;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
/** A runaway rule must never freeze the island. */
const MAX_STEPS = 5000;

function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseProp(line: string): Prop | null {
  // NAME;PARAM=VALUE;PARAM="QUOTED:VALUE":value
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ":" && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i).split(";");
  const params: Record<string, string> = {};
  for (const p of head.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: head[0].toUpperCase(), params, value: line.slice(i + 1) };
}

function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** An iCal date or date-time; all-day when it has no time part. */
export function parseIcsDate(value: string, params: Record<string, string> = {}): { date: Date; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (hh == null || params.VALUE === "DATE") {
    return { date: new Date(+y, +mo - 1, +d), allDay: true };
  }
  const date = z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +(ss ?? 0)))
    : new Date(+y, +mo - 1, +d, +hh, +mm, +(ss ?? 0));
  return Number.isFinite(date.getTime()) ? { date, allDay: false } : null;
}

/** ISO 8601 duration (P1D, PT1H30M, P1W) in milliseconds. */
function parseDuration(v: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+(w ?? 0) * 7 + +(d ?? 0)) * 86400 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000;
  return sign === "-" ? -ms : ms;
}

function readEvents(text: string): Raw[] {
  const out: Raw[] = [];
  let props: Prop[] | null = null;
  let depth = 0;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      props = [];
      depth = 0;
      continue;
    }
    if (!props) continue;
    if (line.startsWith("BEGIN:")) { depth++; continue; } // VALARM inside an event
    if (line.startsWith("END:") && depth > 0) { depth--; continue; }
    if (line === "END:VEVENT") {
      const raw = toRaw(props);
      if (raw) out.push(raw);
      props = null;
      continue;
    }
    if (depth > 0) continue;
    const p = parseProp(line);
    if (p) props.push(p);
  }
  return out;
}

function toRaw(props: Prop[]): Raw | null {
  const one = (name: string) => props.find((p) => p.name === name);
  const dtstart = one("DTSTART");
  if (!dtstart) return null;
  const start = parseIcsDate(dtstart.value, dtstart.params);
  if (!start) return null;
  let end: Date;
  const dtend = one("DTEND");
  const duration = one("DURATION");
  const parsedEnd = dtend ? parseIcsDate(dtend.value, dtend.params) : null;
  if (parsedEnd) end = parsedEnd.date;
  else if (duration) end = new Date(start.date.getTime() + parseDuration(duration.value));
  else end = new Date(start.date.getTime() + (start.allDay ? DAY_MS : 0));
  if (end < start.date) end = start.date;

  const rruleProp = one("RRULE");
  let rrule: Record<string, string> | null = null;
  if (rruleProp) {
    rrule = {};
    for (const part of rruleProp.value.split(";")) {
      const [k, v] = part.split("=");
      if (k && v) rrule[k.toUpperCase()] = v.toUpperCase();
    }
  }
  const exdates = new Set<number>();
  for (const p of props.filter((q) => q.name === "EXDATE")) {
    for (const v of p.value.split(",")) {
      const d = parseIcsDate(v, p.params);
      if (d) exdates.add(d.date.getTime());
    }
  }
  const rid = one("RECURRENCE-ID");
  const ridDate = rid ? parseIcsDate(rid.value, rid.params) : null;
  return {
    uid: one("UID")?.value ?? `${dtstart.value}-${one("SUMMARY")?.value ?? ""}`,
    title: unescapeText(one("SUMMARY")?.value ?? ""),
    location: unescapeText(one("LOCATION")?.value ?? ""),
    start: start.date,
    end,
    allDay: start.allDay,
    rrule,
    exdates,
    recurrenceId: ridDate ? ridDate.date.getTime() : null,
    cancelled: (one("STATUS")?.value ?? "").toUpperCase() === "CANCELLED",
  };
}

/** `date` with its time of day copied from `time` (local clock). */
function withTime(date: Date, time: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.getHours(), time.getMinutes(), time.getSeconds());
}

/** The `n`th (1-based, or −1 = last) `weekday` of a month, or null. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date | null {
  if (n > 0) {
    const first = new Date(year, month, 1);
    const day = 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7;
    const d = new Date(year, month, day);
    return d.getMonth() === month ? d : null;
  }
  const last = new Date(year, month + 1, 0);
  const day = last.getDate() - ((last.getDay() - weekday + 7) % 7) + (n + 1) * 7;
  const d = new Date(year, month, day);
  return d.getMonth() === month && day > 0 ? d : null;
}

/** Every start of a recurring event, in order, until `until` (or the rule ends). */
function* occurrences(ev: Raw, until: Date): Generator<Date> {
  const r = ev.rrule!;
  const freq = r.FREQ;
  const interval = Math.max(1, Number(r.INTERVAL) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const ruleEnd = r.UNTIL ? parseIcsDate(r.UNTIL)?.date ?? null : null;
  const stop = ruleEnd && ruleEnd < until ? ruleEnd : until;
  const byDay = r.BYDAY ? r.BYDAY.split(",") : [];
  const byMonthDay = r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : [];
  const s = ev.start;
  let emitted = 0;
  let steps = 0;

  const accept = function* (d: Date) {
    if (d < s) return;
    if (d > stop || emitted >= count) return;
    emitted++;
    yield d;
  };

  if (freq === "DAILY") {
    for (let d = s; d <= stop && emitted < count && steps++ < MAX_STEPS; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + interval, d.getHours(), d.getMinutes(), d.getSeconds())) {
      if (byDay.length && !byDay.includes(WEEKDAYS[d.getDay()])) continue;
      yield* accept(d);
    }
  } else if (freq === "WEEKLY") {
    const days = byDay.length ? byDay.map((b) => WEEKDAYS.indexOf(b.slice(-2))).filter((i) => i >= 0) : [s.getDay()];
    // Weeks start on Monday (Google's default WKST).
    const mondayOffset = (s.getDay() + 6) % 7;
    let weekStart = new Date(s.getFullYear(), s.getMonth(), s.getDate() - mondayOffset);
    const order = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    while (weekStart <= stop && emitted < count && steps++ < MAX_STEPS) {
      for (const wd of order) {
        const d = withTime(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + ((wd + 6) % 7)), s);
        yield* accept(d);
      }
      weekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7 * interval);
    }
  } else if (freq === "MONTHLY") {
    let y = s.getFullYear();
    let m = s.getMonth();
    while (new Date(y, m, 1) <= stop && emitted < count && steps++ < MAX_STEPS) {
      const dates: Date[] = [];
      if (byDay.length) {
        for (const b of byDay) {
          const wd = WEEKDAYS.indexOf(b.slice(-2));
          const n = b.length > 2 ? Number(b.slice(0, -2)) : 0;
          if (wd < 0) continue;
          if (n) {
            const d = nthWeekday(y, m, wd, n);
            if (d) dates.push(d);
          } else {
            for (let k = 1; k <= 5; k++) {
              const d = nthWeekday(y, m, wd, k);
              if (d) dates.push(d);
            }
          }
        }
      } else {
        const days = byMonthDay.length ? byMonthDay : [s.getDate()];
        for (const md of days) {
          const last = new Date(y, m + 1, 0).getDate();
          const day = md > 0 ? md : last + md + 1;
          if (day >= 1 && day <= last) dates.push(new Date(y, m, day));
        }
      }
      dates.sort((a, b) => a.getTime() - b.getTime());
      for (const d of dates) yield* accept(withTime(d, s));
      m += interval;
      y += Math.floor(m / 12);
      m %= 12;
    }
  } else if (freq === "YEARLY") {
    for (let y = s.getFullYear(); new Date(y, 0, 1) <= stop && emitted < count && steps++ < MAX_STEPS; y += interval) {
      const d = new Date(y, s.getMonth(), s.getDate(), s.getHours(), s.getMinutes(), s.getSeconds());
      if (d.getMonth() !== s.getMonth()) continue; // 29 February
      yield* accept(d);
    }
  } else {
    yield* accept(s); // an unknown rule: at least the first one
  }
}

/** The events of `text` that overlap [from, to], recurring ones expanded, sorted by start. */
export function eventsBetween(text: string, from: Date, to: Date): CalEvent[] {
  const raws = readEvents(text);
  const overrides = new Map<string, Raw>();
  for (const r of raws) {
    if (r.recurrenceId != null) overrides.set(`${r.uid}@${r.recurrenceId}`, r);
  }
  const out: CalEvent[] = [];
  const push = (r: Raw, start: Date, end: Date, key: string) => {
    if (r.cancelled) return;
    if (end <= from && !(r.allDay && end.getTime() === start.getTime())) return;
    if (start > to) return;
    out.push({ id: key, title: r.title || "(No title)", location: r.location, start, end, allDay: r.allDay });
  };
  for (const r of raws) {
    if (r.recurrenceId != null) {
      push(r, r.start, r.end, `${r.uid}@${r.recurrenceId}`);
      continue;
    }
    if (!r.rrule) {
      push(r, r.start, r.end, r.uid);
      continue;
    }
    const length = r.end.getTime() - r.start.getTime();
    for (const start of occurrences(r, to)) {
      const t = start.getTime();
      if (r.exdates.has(t) || overrides.has(`${r.uid}@${t}`)) continue;
      push(r, start, new Date(t + length), `${r.uid}@${t}`);
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay));
}
