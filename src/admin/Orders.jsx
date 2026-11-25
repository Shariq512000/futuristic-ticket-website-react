import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { adminApi } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import {
  fmtDateTime, fmtDay, money, shortId,
} from '../lib/format.js';
import {
  ErrorBox, Loading, LinkRow, StatusPill,
} from './ui.jsx';

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const qs = params.toString();
  const { data, error, loading } = useAsync(
    () => Promise.all([adminApi(`/orders?${qs}`), adminApi('/matches')]),
    [qs],
  );

  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const [result, matches] = data;

  return (
    <>
      <div className="head"><div><h1>Orders</h1><p>{loading ? 'Loading…' : `${result.total.toLocaleString()} order(s)`}</p></div></div>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); update({ q }); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or order number" style={{ minWidth: 260 }} />
        <select value={params.get('matchId') || ''} onChange={(e) => update({ matchId: e.target.value })}>
          <option value="">All matches</option>
          {matches.map((m) => <option key={m.id} value={m.id}>{m.title} · {fmtDay(m.date)}</option>)}
        </select>
        <select value={params.get('status') || ''} onChange={(e) => update({ status: e.target.value })}>
          <option value="">Any status</option><option value="confirmed">confirmed</option><option value="cancelled">cancelled</option>
        </select>
        <button className="btn" type="submit">Search</button>
      </form>
      <div className="box"><div className="tbl-wrap"><table><tbody>
        <tr><th>Order</th><th>Customer</th><th>Match</th><th className="num">Seats</th><th className="num">Total</th><th>Placed</th><th>Status</th></tr>
        {result.orders.length ? result.orders.map((o) => (
          <LinkRow key={o.id} to={`/admin/orders/${o.id}`}>
            <td><b>{shortId(o.id)}</b></td>
            <td>{o.customer.name}<div className="muted small">{o.customer.email}</div></td>
            <td>{o.match || o.matchId}</td>
            <td className="num">{o.seats}</td>
            <td className="num">{money(o.total, o.currency)}</td>
            <td className="small">{fmtDateTime(o.createdAt)}</td>
            <td><StatusPill status={o.status} /></td>
          </LinkRow>
        )) : <tr><td colSpan={7} className="empty">No orders found</td></tr>}
      </tbody></table></div></div>
      {result.pages > 1 && (
        <div className="row-actions">
          {result.page > 1 && <button type="button" className="btn sm" onClick={() => update({ page: String(result.page - 1) })}>← Previous</button>}
          <span className="muted small">Page {result.page} of {result.pages}</span>
          {result.page < result.pages && <button type="button" className="btn sm" onClick={() => update({ page: String(result.page + 1) })}>Next →</button>}
        </div>
      )}
    </>
  );
}
