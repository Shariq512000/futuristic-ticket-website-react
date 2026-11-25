import { Link } from 'react-router';
import { dateParts, money } from '../lib/format.js';

export default function MatchCard({ match: m }) {
  const d = dateParts(m.date);
  const venue = m.venue || {};
  return (
    <Link className="mcard" to={`/match/${encodeURIComponent(m.id)}`}>
      <div className="mdate"><b>{d.day}</b><span>{d.month}</span></div>
      <div className="minfo">
        <span className="comp">{m.competition} · {m.stage}</span>
        <b className="mtitle">{m.title}</b>
        <span className="meta">{d.weekday} {d.time} · {venue.name}{venue.city ? `, ${venue.city}` : ''}</span>
      </div>
      <div className="mbuy">
        {m.fromPrice != null && (<><span>from</span><b>{money(m.fromPrice, m.currency)}</b></>)}
        <span className="cta">Choose seats →</span>
      </div>
    </Link>
  );
}

export function LoadError({ error, onRetry }) {
  return (
    <div className="empty-box error">
      <b>Could not load this page</b>
      <span>{error.message}</span>
      <button type="button" className="chip" onClick={onRetry}>Try again</button>
    </div>
  );
}
