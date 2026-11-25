import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { adminApi } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { ErrorBox, Loading, useToast } from './ui.jsx';

const TEMPLATE = {
  id: 'new-ground',
  name: 'New Ground',
  sport: 'football',
  city: '',
  field: { length: 124, width: 88, superellipse: 8 },
  stands: [
    { id: 'north', name: 'North Stand', from: 327, to: 33, frontGap: 3, capacity: 4000 },
    { id: 'east', name: 'East Stand', from: 39, to: 141, frontGap: 3, capacity: 6000 },
    { id: 'south', name: 'South Stand', from: 147, to: 213, frontGap: 3, capacity: 4000 },
    {
      id: 'west', name: 'West Stand', from: 219, to: 321, frontGap: 3, roof: true,
      tiers: [{ key: 'lower', name: 'West Lower', capacity: 4000 }, { key: 'upper', name: 'West Upper', capacity: 3000, rise: 0.55 }],
    },
  ],
  extras: { floodlights: { towers: 4 } },
};

export default function StadiumEditor() {
  const { id } = useParams();
  const { data, error } = useAsync(
    () => (id ? adminApi(`/stadiums/${encodeURIComponent(id)}`) : Promise.resolve(null)),
    [id],
  );
  if (error) return <ErrorBox error={error} />;
  if (id && !data) return <Loading />;
  return <Editor key={id || 'new'} id={id} initial={data} />;
}

function Editor({ id, initial }) {
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = !id;
  const config = initial?.config || TEMPLATE;
  const [text, setText] = useState(() => JSON.stringify(config, null, 2));
  const [summary, setSummary] = useState(initial?.summary || null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const parse = () => {
    try { return JSON.parse(text); } catch (e) { setErr(`JSON error: ${e.message}`); return null; }
  };

  async function check() {
    setErr('');
    const cfg = parse();
    if (!cfg) return;
    try {
      setSummary(await adminApi('/stadiums/validate', { method: 'POST', body: { config: cfg, id } }));
    } catch (e) { setErr(e.message); }
  }

  async function save(force = false) {
    setErr('');
    const cfg = parse();
    if (!cfg) return;
    setBusy(true);
    try {
      const r = await adminApi(isNew ? '/stadiums' : `/stadiums/${encodeURIComponent(id)}${force ? '?force=1' : ''}`, {
        method: isNew ? 'POST' : 'PUT', body: { config: cfg },
      });
      setSummary(r.summary);
      toast(isNew ? 'Stadium created' : 'Layout saved');
      if (isNew) navigate(`/admin/stadiums/${r.id}`);
    } catch (e) {
      setErr(e.message);
      if (e.status === 409 && e.data?.missing
        && window.confirm(`${e.message}.\n\nThose bookings would point at seats that no longer exist. Save anyway?`)) {
        setBusy(false);
        save(true);
        return;
      }
    }
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm(`Delete stadium "${config.name}"? This cannot be undone.`)) return;
    try {
      await adminApi(`/stadiums/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Stadium deleted');
      navigate('/admin/stadiums');
    } catch (e) { toast(e.message, 'error'); }
  }

  const onKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const ta = e.currentTarget;
    ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
    setText(ta.value);
  };

  return (
    <>
      <Link className="backlink" to="/admin/stadiums">← Stadiums</Link>
      <div className="head">
        <div><h1>{isNew ? 'New stadium' : config.name}</h1><p>Layout config (JSON). The README explains every field.</p></div>
        {!isNew && <button type="button" className="btn danger" onClick={remove}>Delete stadium</button>}
      </div>
      <div className="split">
        <div className="box"><h2>Config</h2><div className="pad">
          <textarea className="code" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />
          <div className="form-error">{err}</div>
          <div className="row-actions">
            <button type="button" className="btn" onClick={check}>Check layout</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => save(false)}>{isNew ? 'Create stadium' : 'Save layout'}</button>
          </div>
          <p className="note">Changing stands, tiers or capacities changes seat numbers. Saving is refused if seats that are already sold or held would disappear.</p>
        </div></div>
        <div className="box"><h2>Layout check</h2>
          {summary ? <Summary s={summary} /> : <div className="pad muted">Press &quot;Check layout&quot; to count seats.</div>}
        </div>
      </div>
    </>
  );
}

function Summary({ s }) {
  return (
    <>
      <div className="pad"><div className="muted small">TOTAL SEATS</div><div className="big">{s.seats.toLocaleString()}</div></div>
      <table><tbody>
        <tr><th>Stand</th><th className="num">Rows</th><th className="num">Seats</th></tr>
        {s.stands.map((st) => (
          <tr key={st.id}>
            <td><b>{st.name}</b><div className="muted small">{st.tiers.map((t) => `${t.name || t.key}: ${t.seats.toLocaleString()}`).join(' · ')}</div></td>
            <td className="num">{st.tiers.map((t) => t.rows).join(' + ')}</td>
            <td className="num">{st.seats.toLocaleString()}</td>
          </tr>
        ))}
      </tbody></table>
    </>
  );
}
