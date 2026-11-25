// API clients for the Express server: public site (/api) and admin panel (/api/admin).

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(base, path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is it running?', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  return data;
}

const pub = (path, opts) => request('/api', path, opts);
const enc = encodeURIComponent;

export const api = {
  sports: () => pub('/sports'),
  sport: (id) => pub(`/sports/${enc(id)}`),
  matches: (query = {}) => pub(`/matches?${new URLSearchParams(query)}`),
  match: (id) => pub(`/matches/${enc(id)}`),
  availability: (id, holdId) => pub(`/matches/${enc(id)}/availability${holdId ? `?hold=${enc(holdId)}` : ''}`),
  hold: (matchId, seatIds) => pub('/holds', { method: 'POST', body: { matchId, seatIds } }),
  release: (holdId) => pub(`/holds/${enc(holdId)}`, { method: 'DELETE' }),
  order: (holdId, customer) => pub('/orders', { method: 'POST', body: { holdId, customer } }),
};

// Admin calls. A 401 means the session ended; AdminApp listens for this event.
export async function adminApi(path, opts) {
  try {
    return await request('/api/admin', path, opts);
  } catch (err) {
    if (err.status === 401 && path !== '/login') window.dispatchEvent(new Event('admin:unauthorized'));
    throw err;
  }
}
