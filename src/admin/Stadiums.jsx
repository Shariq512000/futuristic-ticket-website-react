import { Link } from 'react-router';
import { adminApi } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { fmtDateTime } from '../lib/format.js';
import { ErrorBox, Loading, LinkRow } from './ui.jsx';

export default function Stadiums() {
  const { data: list, error } = useAsync(() => adminApi('/stadiums'), []);
  if (error) return <ErrorBox error={error} />;
  if (!list) return <Loading />;
  return (
    <>
      <div className="head">
        <div><h1>Stadiums</h1><p>Venue layouts. Seat counts come from each layout.</p></div>
        <Link className="btn primary" to="/admin/stadiums/new">+ New stadium</Link>
      </div>
      <div className="box"><div className="tbl-wrap"><table><tbody>
        <tr><th>Stadium</th><th>Sport</th><th>City</th><th className="num">Stands</th><th className="num">Seats</th><th className="num">Matches</th><th>Updated</th></tr>
        {list.map((s) => (
          <LinkRow key={s.id} to={`/admin/stadiums/${s.id}`}>
            <td><b>{s.name}</b> {s.sample && <span className="pill">sample</span>}<div className="muted small">{s.id}</div></td>
            <td>{s.sport}</td><td>{s.city}</td>
            <td className="num">{s.stands}</td><td className="num">{s.seats.toLocaleString()}</td><td className="num">{s.matches}</td>
            <td className="small">{fmtDateTime(s.updatedAt)}</td>
          </LinkRow>
        ))}
      </tbody></table></div></div>
    </>
  );
}
