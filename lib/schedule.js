// US prime-time slot planner. Slots are defined in US Eastern time and converted to the user's own
// clock (the time zone the social platforms use for their native schedulers).
const US_SLOTS_ET = ['08:00', '12:00', '15:30', '18:30', '21:00']; // up to 5 videos/day, spaced hours apart
const MIN_GAP_MS = 2.5 * 3600 * 1000;
const LEAD_MS = 20 * 60 * 1000; // platforms need a few minutes of lead time

// Convert a wall-clock time in an IANA zone to a UTC timestamp.
function zonedToUtc(y, mo, d, h, mi, tz) {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(new Date(guess)).reduce((a, p) => (a[p.type] = +p.value, a), {});
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    guess += Date.UTC(y, mo - 1, d, h, mi) - asUtc;
  }
  return guess;
}

function nextSlots(count, taken = [], now = Date.now()) {
  const out = [];
  const etNow = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(now)).reduce((a, p) => (a[p.type] = +p.value, a), {});
  for (let day = 0; day < 14 && out.length < count; day++) {
    const base = new Date(Date.UTC(etNow.year, etNow.month - 1, etNow.day + day));
    for (const s of US_SLOTS_ET) {
      const [h, m] = s.split(':').map(Number);
      const t = zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, m, 'America/New_York');
      if (t < now + LEAD_MS) continue;
      if ([...taken, ...out].some((x) => Math.abs(x - t) < MIN_GAP_MS)) continue;
      out.push(t);
      if (out.length >= count) break;
    }
  }
  return out;
}

function fmtLocal(ts) {
  return new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}
function fmtET(ts) {
  return new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}
// Pieces for typing into a native scheduler: local date (YYYY-MM-DD) and 24h/12h time.
function localParts(ts) {
  const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
  const h12 = d.getHours() % 12 || 12;
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time24: `${p(d.getHours())}:${p(d.getMinutes())}`, time12: `${h12}:${p(d.getMinutes())} ${d.getHours() >= 12 ? 'PM' : 'AM'}` };
}

module.exports = { nextSlots, fmtLocal, fmtET, localParts, US_SLOTS_ET };
