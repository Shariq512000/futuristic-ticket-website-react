const TZ = 'Asia/Karachi';

export const money = (n, currency = 'PKR') => `${currency} ${Number(n || 0).toLocaleString('en-US')}`;

export const fmtDate = (iso) => new Date(iso).toLocaleString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ,
});

export const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ,
});

export const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ });

export function dateParts(iso) {
  const d = new Date(iso);
  const part = (o) => d.toLocaleString('en-GB', { ...o, timeZone: TZ });
  return {
    day: part({ day: 'numeric' }),
    month: part({ month: 'short' }).toUpperCase(),
    weekday: part({ weekday: 'short' }),
    time: part({ hour: '2-digit', minute: '2-digit' }),
  };
}

export const sportName = (id) => (id ? id[0].toUpperCase() + id.slice(1) : '');
export const shortId = (id) => String(id).slice(-8).toUpperCase();
export const plural = (n, word, many = `${word}es`) => `${n} ${n === 1 ? word : many}`;

// <input type="datetime-local"> values in Pakistan time (UTC+5, no daylight saving)
export const toLocalInput = (d) => new Date(new Date(d).getTime() + 5 * 3600 * 1000).toISOString().slice(0, 16);
export const fromLocalInput = (v) => new Date(`${v}:00+05:00`).toISOString();
