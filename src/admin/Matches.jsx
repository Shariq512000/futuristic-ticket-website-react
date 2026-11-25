import { Link, useSearchParams } from 'react-router';
import { adminApi } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { fmtDateTime, money } from '../lib/format.js';
import {
  ErrorBox, Loading, LinkRow, StatusPill,
} from './ui.jsx';

const WHEN = [['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All dates']];

export default function Matches() {
  const [params, setParams] = useSearchParams();
  const sport = params.get('sport') || '';
  const when = params.get('when') || 'upcoming';
  const { data, error, loading } = useAsync(() => Promise.all([
    adminApi('/sports'),
    adminApi(`/matches?${new URLSearchParams({ ...(sport && { sport }), ...(when !== 'all' && { when }) })}`),
    adminApi('/stadiums'),
  ]), [sport, when]);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const [sports, matches, stadiums] = data;
  const venue = Object.fromEntries(stadiums.map((s) => [s.id, s.name]));

  return (
    <>
      <div className="head">
        <div><h1>Matches</h1><p>{loading ? 'Loading…' : `${matches.length} shown`}</p></div>
        <Link className="btn primary" to="/admin/matches/new">+ New match</Link>
      </div>
      <div className="filters">
        <select value={sport} onChange={(e) => setFilter('sport', e.target.value)}>
          <option value="">All sports</option>
          {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={when} onChange={(e) => setFilter('when', e.target.value)}>
          {WHEN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="box"><div className="tbl-wrap"><table><tbody>
        <tr><th>Match</th><th>Competition</th><th>Date</th><th>Venue</th><th className="num">From</th><th>Status</th></tr>
        {matches.length ? matches.map((m) => {
          const all = [m.prices?.default, ...Object.values(m.prices?.stands || {}), ...Object.values(m.prices?.tiers || {})].filter((p) => p != null);
          return (
            <LinkRow key={m.id} to={`/admin/matches/${m.id}`}>
              <td><b>{m.title}</b><div className="muted small">{m.id} · {m.sport}</div></td>
              <td>{m.competition}<div className="muted small">{m.stage}</div></td>
              <td className="small">{fmtDateTime(m.date)}</td>
              <td>{venue[m.stadiumId] || m.stadiumId}</td>
              <td className="num">{all.length ? money(Math.min(...all), m.currency) : '—'}</td>
              <td><StatusPill status={m.status} /></td>
            </LinkRow>
          );
        }) : <tr><td colSpan={6} className="empty">No matches</td></tr>}
      </tbody></table></div></div>
    </>
  );
}
