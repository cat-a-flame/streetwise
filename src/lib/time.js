const TZ = 'Europe/Budapest';

const parts = (date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, Number(p.value)]),
  );

// 09:00 Budapest time on the next weekday after `now`: a typical commute to arrive for.
export function commuteInstant(now = new Date(), hour = 9) {
  const p = parts(now);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day));
  do day.setUTCDate(day.getUTCDate() + 1);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6);
  const guess = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, 0);
  const q = parts(new Date(guess));
  const offsetMin = Math.round((Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) - guess) / 60000);
  return new Date(guess - offsetMin * 60000);
}

export const fmtClock = (iso) =>
  new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
