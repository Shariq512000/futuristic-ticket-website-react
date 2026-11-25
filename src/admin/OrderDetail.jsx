import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { adminApi } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { fmtDateTime, money, shortId } from '../lib/format.js';
import {
  ErrorBox, Loading, StatusPill, useToast,
} from './ui.jsx';

export default function OrderDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data: o, error, reload } = useAsync(() => adminApi(`/orders/${encodeURIComponent(id)}`), [id]);

  async function cancel() {
    if (!window.confirm('Cancel this order? Its seats go back on sale immediately.')) return;
    setBusy(true);
    try {
      const r = await adminApi(`/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      toast(`Order cancelled, ${r.released} seat(s) back on sale`);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox error={error} />;
  if (!o) return <Loading />;
  const cur = o.currency;

  return (
    <>
      <Link className="backlink" to="/admin/orders">← Orders</Link>
      <div className="head">
        <div><h1>Order {shortId(o.id)}</h1><p>{fmtDateTime(o.createdAt)} · <StatusPill status={o.status} /></p></div>
        {o.status === 'confirmed' && (
          <button type="button" className="btn danger" disabled={busy} onClick={cancel}>Cancel order &amp; release seats</button>
        )}
      </div>
      <div className="box"><h2>Details</h2><div className="pad"><dl className="kv">
        <dt>Customer</dt><dd>{o.customer.name}</dd>
        <dt>Email</dt><dd><a href={`mailto:${o.customer.email}`}>{o.customer.email}</a></dd>
        <dt>Match</dt><dd><Link to={`/admin/matches/${o.match.id}`}>{o.match.title || o.match.id}</Link>{o.match.date ? ` · ${fmtDateTime(o.match.date)}` : ''}</dd>
        <dt>Order ID</dt><dd className="small muted">{o.id}</dd>
      </dl></div></div>
      <div className="box"><h2>Seats</h2><div className="tbl-wrap"><table><tbody>
        <tr><th>Seat</th><th className="num">Price</th></tr>
        {o.seats.map((s) => (
          <tr key={s.seatId}><td>{s.label}<div className="muted small">{s.seatId}</div></td><td className="num">{money(s.price, cur)}</td></tr>
        ))}
        <tr><td className="muted">Service fee</td><td className="num">{money(o.fee, cur)}</td></tr>
        <tr><td><b>Total</b></td><td className="num"><b>{money(o.total, cur)}</b></td></tr>
      </tbody></table></div></div>
      <p className="note">Demo system: no payment was taken, so cancelling issues no refund.</p>
    </>
  );
}
