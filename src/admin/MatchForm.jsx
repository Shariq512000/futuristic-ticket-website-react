import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { adminApi } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { fromLocalInput, toLocalInput } from '../lib/format.js';
import { ErrorBox, Loading, useToast } from './ui.jsx';

const TEXT_FIELDS = ['title', 'short', 'competition', 'stage', 'home', 'away', 'currency'];

// Create (/admin/matches/new) or edit (/admin/matches/:id) a match, including prices.
export default function MatchForm() {
  const { id } = useParams();
  const isNew = !id;
  const { data, error, reload } = useAsync(() => Promise.all([
    adminApi('/sports'),
    adminApi('/stadiums'),
    isNew ? null : adminApi(`/matches/${encodeURIComponent(id)}`),
  ]), [id]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const [sports, stadiums, match] = data;
  return <MatchEditor key={match?.updatedAt || 'new'} sports={sports} stadiums={stadiums} match={match} onSaved={reload} />;
}

function MatchEditor({ sports, stadiums, match, onSaved }) {
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = !match;
  const locked = !isNew && match.bookings > 0;
  const [form, setForm] = useState(() => {
    const m = match || {
      sport: sports[0]?.id, stadiumId: '', title: '', short: '', competition: '', stage: '', home: '', away: '',
      date: new Date(Date.now() + 14 * 864e5).toISOString(), currency: 'PKR', status: 'scheduled',
      prices: { default: 1000, stands: {}, tiers: {} },
    };
    return {
      ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, m[k] ?? ''])),
      sport: m.sport, stadiumId: m.stadiumId, status: m.status, date: toLocalInput(m.date),
      defaultPrice: String(m.prices?.default ?? ''),
      stands: Object.fromEntries(Object.entries(m.prices?.stands || {}).map(([k, v]) => [k, String(v)])),
      tiers: Object.fromEntries(Object.entries(m.prices?.tiers || {}).map(([k, v]) => [k, String(v)])),
    };
  });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const venues = useMemo(
    () => stadiums.filter((s) => s.sport === form.sport || s.id === match?.stadiumId),
    [stadiums, form.sport, match],
  );
  // Keep the venue valid for the chosen sport
  useEffect(() => {
    if (!venues.some((v) => v.id === form.stadiumId)) {
      setForm((f) => ({ ...f, stadiumId: venues[0]?.id || '', stands: {}, tiers: {} }));
    }
  }, [venues, form.stadiumId]);

  const venue = useAsync(
    () => (form.stadiumId ? adminApi(`/stadiums/${encodeURIComponent(form.stadiumId)}`) : Promise.resolve(null)),
    [form.stadiumId],
  );

  async function save(e) {
    e.preventDefault();
    setErr('');
    if (!form.date) { setErr('Pick a date and time'); return; }
    if (form.status === 'cancelled' && match?.status !== 'cancelled' && !isNew
      && !window.confirm('Cancel this match? It disappears from the public site and nobody can buy tickets. Existing orders are not refunded automatically.')) return;
    const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ''));
    const body = {
      ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, form[k]])),
      sport: form.sport, stadiumId: form.stadiumId, status: form.status, date: fromLocalInput(form.date),
      prices: { default: form.defaultPrice, stands: clean(form.stands), tiers: clean(form.tiers) },
    };
    setSaving(true);
    try {
      const saved = await adminApi(isNew ? '/matches' : `/matches/${encodeURIComponent(match.id)}`, { method: isNew ? 'POST' : 'PUT', body });
      toast(isNew ? 'Match created' : 'Changes saved');
      if (isNew) navigate(`/admin/matches/${saved.id}`);
      else onSaved();
    } catch (e2) {
      setErr(e2.message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${match.title}" permanently? This cannot be undone.`)) return;
    try {
      await adminApi(`/matches/${encodeURIComponent(match.id)}`, { method: 'DELETE' });
      toast('Match deleted');
      navigate('/admin/matches');
    } catch (e2) { toast(e2.message, 'error'); }
  }

  return (
    <>
      <Link className="backlink" to="/admin/matches">← Matches</Link>
      <div className="head">
        <div>
          <h1>{isNew ? 'New match' : match.title}</h1>
          <p>{isNew ? 'Create a fixture and set its prices'
            : `${match.id} · ${match.orders} order(s) · ${match.bookings.toLocaleString()} seat(s) sold or held`}</p>
        </div>
        {!isNew && (
          <div className="row-actions">
            <a className="btn" href={`/match/${match.id}`} target="_blank" rel="noopener noreferrer">View on site</a>
            <Link className="btn" to={`/admin/orders?matchId=${match.id}`}>Orders</Link>
          </div>
        )}
      </div>

      <form onSubmit={save} noValidate>
        <div className="box"><h2>Details</h2><div className="pad grid">
          <label className="f">Sport
            <select value={form.sport} onChange={set('sport')} disabled={locked}>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="f">Venue
            <select value={form.stadiumId} onChange={(e) => setForm((f) => ({ ...f, stadiumId: e.target.value, stands: {}, tiers: {} }))} disabled={locked}>
              {venues.length ? venues.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.seats.toLocaleString()} seats)</option>)
                : <option value="">No stadiums for this sport yet</option>}
            </select>
            {locked && <span className="note">Locked: seats are already sold or held.</span>}
          </label>
          <label className="f">Date &amp; time (Pakistan time)<input type="datetime-local" value={form.date} onChange={set('date')} /></label>
          <label className="f">Status
            <select value={form.status} onChange={set('status')}>
              <option value="scheduled">scheduled</option><option value="cancelled">cancelled</option>
            </select>
          </label>
          <label className="f wide">Title<input value={form.title} onChange={set('title')} placeholder="Pakistan vs New Zealand" maxLength={120} /></label>
          <label className="f">Home team<input value={form.home} onChange={set('home')} maxLength={120} /></label>
          <label className="f">Away team<input value={form.away} onChange={set('away')} maxLength={120} /></label>
          <label className="f">Short name (big screens)<input value={form.short} onChange={set('short')} placeholder="PAK vs NZ" maxLength={40} /></label>
          <label className="f">Competition<input value={form.competition} onChange={set('competition')} maxLength={120} /></label>
          <label className="f">Stage<input value={form.stage} onChange={set('stage')} placeholder="Group A" maxLength={120} /></label>
          <label className="f">Currency<input value={form.currency} onChange={set('currency')} maxLength={3} /></label>
        </div></div>

        <div className="box"><h2>Prices</h2>
          <div className="pad">
            <label className="f" style={{ maxWidth: 240 }}>Default price (every seat)
              <input type="number" min="0" step="1" value={form.defaultPrice} onChange={set('defaultPrice')} />
            </label>
            <p className="note">Leave a stand or tier empty to use the price above it. Tier prices override stand prices.</p>
          </div>
          <div className="tbl-wrap"><PriceTable venue={venue} form={form} setForm={setForm} /></div>
        </div>

        <div className="form-error">{err}</div>
        <div className="row-actions">
          <button className="btn primary" type="submit" disabled={saving}>{isNew ? 'Create match' : 'Save changes'}</button>
          {!isNew && <button className="btn danger" type="button" onClick={remove}>Delete match</button>}
        </div>
      </form>
    </>
  );
}

function PriceTable({ venue, form, setForm }) {
  if (venue.error) return <div className="pad muted">{venue.error.message}</div>;
  if (!venue.data) return venue.loading ? <div className="pad"><Loading /></div> : null;
  const setPrice = (group, key) => (e) => setForm((f) => ({ ...f, [group]: { ...f[group], [key]: e.target.value } }));
  return (
    <table className="prices"><tbody>
      <tr><th>Stand / tier</th><th className="num">Seats</th><th className="num">Price</th></tr>
      {venue.data.summary.stands.map((s) => (
        <StandRows key={s.id} stand={s} form={form} setPrice={setPrice} />
      ))}
    </tbody></table>
  );
}

function StandRows({ stand: s, form, setPrice }) {
  const showTiers = s.tiers.length > 1 || s.tiers[0]?.name;
  return (
    <>
      <tr>
        <td><b>{s.name}</b> <span className="muted small">{s.id}</span></td>
        <td className="num">{s.seats.toLocaleString()}</td>
        <td className="num"><input type="number" min="0" step="1" placeholder="default" value={form.stands[s.id] ?? ''} onChange={setPrice('stands', s.id)} /></td>
      </tr>
      {showTiers && s.tiers.map((t, i) => {
        // Two tiers can share a key (e.g. boxes on two floors); they share one price.
        const key = `${s.id}.${t.key}`;
        return (
          <tr className="tier" key={`${key}-${i}`}>
            <td>{t.name || t.key} <span className="small">({t.key})</span></td>
            <td className="num">{t.seats.toLocaleString()}</td>
            <td className="num"><input type="number" min="0" step="1" placeholder="stand" value={form.tiers[key] ?? ''} onChange={setPrice('tiers', key)} /></td>
          </tr>
        );
      })}
    </>
  );
}
