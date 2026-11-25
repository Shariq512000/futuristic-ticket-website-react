import { useState } from 'react';
import { adminApi } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { ErrorBox, Loading, useToast } from './ui.jsx';

export default function Sports() {
  const toast = useToast();
  const { data: list, error, reload } = useAsync(() => adminApi('/sports'), []);
  const [draft, setDraft] = useState({ id: '', name: '', tagline: '' });

  async function add(e) {
    e.preventDefault();
    try {
      await adminApi('/sports', { method: 'POST', body: draft });
      toast('Sport added');
      setDraft({ id: '', name: '', tagline: '' });
      reload();
    } catch (err) { toast(err.message, 'error'); }
  }

  if (error) return <ErrorBox error={error} />;
  if (!list) return <Loading />;

  return (
    <>
      <div className="head"><div><h1>Sports</h1><p>Shown on the home page in this order.</p></div></div>
      <div className="box"><div className="tbl-wrap"><table><tbody>
        <tr><th>ID</th><th>Name</th><th>Tagline</th><th className="num">Order</th><th className="num">Matches</th><th /></tr>
        {list.map((s) => <SportRow key={s.id} sport={s} onChanged={reload} />)}
      </tbody></table></div></div>

      <div className="box"><h2>Add a sport</h2>
        <form className="pad grid" onSubmit={add} noValidate>
          <label className="f">ID (used in links)<input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="tennis" maxLength={63} /></label>
          <label className="f">Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Tennis" maxLength={60} /></label>
          <label className="f">Tagline<input value={draft.tagline} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} placeholder="Grand slam qualifiers" maxLength={120} /></label>
          <div className="f" style={{ alignSelf: 'end' }}><button className="btn primary" type="submit">Add sport</button></div>
        </form>
      </div>
      <p className="note">A new sport needs at least one stadium before it can have matches. Stadium &quot;sport&quot; picks the playing surface (cricket, football or basketball).</p>
    </>
  );
}

function SportRow({ sport: s, onChanged }) {
  const toast = useToast();
  const [v, setV] = useState({ name: s.name, tagline: s.tagline || '', order: s.order ?? 0 });

  async function save() {
    try {
      await adminApi(`/sports/${encodeURIComponent(s.id)}`, { method: 'PUT', body: v });
      toast('Saved');
      onChanged();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function remove() {
    if (!window.confirm(`Delete sport "${s.id}"?`)) return;
    try {
      await adminApi(`/sports/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      toast('Deleted');
      onChanged();
    } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <tr>
      <td className="muted">{s.id}</td>
      <td><input value={v.name} maxLength={60} onChange={(e) => setV({ ...v, name: e.target.value })} /></td>
      <td><input value={v.tagline} maxLength={120} style={{ width: '100%' }} onChange={(e) => setV({ ...v, tagline: e.target.value })} /></td>
      <td className="num"><input type="number" value={v.order} style={{ width: 70 }} onChange={(e) => setV({ ...v, order: e.target.value })} /></td>
      <td className="num">{s.matches}</td>
      <td><div className="row-actions">
        <button type="button" className="btn sm" onClick={save}>Save</button>
        {!s.matches && <button type="button" className="btn sm danger" onClick={remove}>Delete</button>}
      </div></td>
    </tr>
  );
}
