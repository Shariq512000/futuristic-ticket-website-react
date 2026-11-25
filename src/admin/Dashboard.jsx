import { Link } from 'react-router';
import { adminApi } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { fmtDateTime, money, shortId } from '../lib/format.js';
import {
  ErrorBox, Loading, LinkRow, StatusPill,
} from './ui.jsx';

export default function Dashboard() {
  const { data: s, error, loading } = useAsync(() => adminApi('/stats'), []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const upcoming = s.matches.filter((m) => m.upcoming);

  return (
    <>
      <div className="head">
        <div><h1>Dashboard</h1><p>Online sales across all matches</p></div>
        <Link className="btn primary" to="/admin/matches/new">+ New match</Link>
      </div>
      <div className="cards">
        <Card label="Online revenue" value={money(s.totals.revenue)} />
        <Card label="Tickets sold online" value={s.totals.tickets.toLocaleString()} />
        <Card label="Orders" value={s.totals.orders.toLocaleString()} />
        <Card label="Seats on hold now" value={s.totals.activeHolds.toLocaleString()} />
      </div>

      <div className="box"><h2>Upcoming matches</h2><div className="tbl-wrap"><table><tbody>
        <tr><th>Match</th><th>Date</th><th>Venue</th><th>Sold</th><th className="num">Online orders</th><th className="num">Online revenue</th><th>Status</th></tr>
        {upcoming.length ? upcoming.map((m) => {
          const pct = m.capacity ? Math.round((m.sold / m.capacity) * 100) : 0;
          return (
            <LinkRow key={m.id} to={`/admin/matches/${m.id}`}>
              <td><b>{m.title}</b><div className="muted small">{m.sport}</div></td>
              <td className="small">{fmtDateTime(m.date)}</td>
              <td>{m.venue}</td>
              <td>
                <div className="progress"><i style={{ width: `${pct}%` }} /></div>
                <div className="muted small">{m.sold.toLocaleString()} / {m.capacity.toLocaleString()} ({pct}%)</div>
              </td>
              <td className="num">{m.online.orders}</td>
              <td className="num">{money(m.online.revenue, m.currency)}</td>
              <td><StatusPill status={m.status} /></td>
            </LinkRow>
          );
        }) : <tr><td colSpan={7} className="empty">No upcoming matches</td></tr>}
      </tbody></table></div></div>

      <div className="box"><h2>Latest orders</h2><div className="tbl-wrap"><table><tbody>
        <tr><th>Order</th><th>Customer</th><th>Match</th><th className="num">Seats</th><th className="num">Total</th><th>Placed</th><th>Status</th></tr>
        {s.recentOrders.length ? s.recentOrders.map((o) => (
          <LinkRow key={o.id} to={`/admin/orders/${o.id}`}>
            <td><b>{shortId(o.id)}</b></td><td>{o.customer}</td><td>{o.match}</td>
            <td className="num">{o.seats}</td><td className="num">{money(o.total, o.currency)}</td>
            <td className="small">{fmtDateTime(o.createdAt)}</td><td><StatusPill status={o.status} /></td>
          </LinkRow>
        )) : <tr><td colSpan={7} className="empty">No orders yet</td></tr>}
      </tbody></table></div></div>
      <p className="note">&quot;Sold&quot; includes seats marked sold by the demo seed; revenue and orders count online orders only.</p>
    </>
  );
}

function Card({ label, value }) {
  return <div className="card"><div className="k">{label}</div><div className="v">{value}</div></div>;
}
