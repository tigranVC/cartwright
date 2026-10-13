// Date/time/money helpers. Dates are 'YYYY-MM-DD' strings and timestamps are
// 'YYYY-MM-DDTHH:MM' strings (no timezone), so nothing depends on the host
// clock or timezone. Money is always integer cents.

export const TODAY = '2026-06-15'; // simulated "today" (a Monday)
export const NOW_TIME = '10:00'; // simulated wall clock

export function pad(n, width) {
  return String(n).padStart(width, '0');
}

function toUtc(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function isDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toUtc(v)) &&
    new Date(toUtc(v)).toISOString().slice(0, 10) === v;
}

export function addDays(date, n) {
  return new Date(toUtc(date) + n * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

export function dayOfWeek(date) {
  return new Date(toUtc(date)).getUTCDay(); // 0 = Sunday
}

/** Monday of the ISO week containing date. */
export function weekStart(date) {
  const dow = dayOfWeek(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export const dateOf = (stamp) => (stamp ? String(stamp).slice(0, 10) : null);

export function fmtMoney(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${dollars}.${pad(abs % 100, 2)}`;
}

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Normalize a tag list: trimmed, non-empty, de-duplicated case-insensitively, original order. */
export function normTags(tags) {
  const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',') : [];
  const out = [];
  const seen = new Set();
  for (const t of list) {
    const v = String(t ?? '').trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

export const hasTag = (tags, tag) => (tags || []).some((t) => t.toLowerCase() === String(tag).toLowerCase());

export function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}
