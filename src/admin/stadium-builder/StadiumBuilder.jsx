// Visual stadium builder: a plain form + live map instead of raw JSON.
// The JSON editor is still available under "Advanced".
import {
  useCallback, useEffect, useMemo, useState,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { computeLayout } from '../../../shared/layout.js';
import { adminApi } from '../../lib/api.js';
import { useAsync } from '../../lib/useAsync.js';
import { ErrorBox, Loading, useToast } from '../ui.jsx';
import { SportIcon } from '../../components/SportIcon.jsx';
import MapPreview from './MapPreview.jsx';
import StandEditor from './StandEditor.jsx';
import Preview3D from './Preview3D.jsx';
import {
  FIELD_DEFAULTS, SPORTS, arcWidth, direction, freeArc, midAngle, newStand, norm, overlaps,
  renameStand, slugify, template, toConfig, toForm,
} from './convert.js';

export default function StadiumBuilderPage() {
  const { id } = useParams();
  const { data, error } = useAsync(
    () => (id ? adminApi(`/stadiums/${encodeURIComponent(id)}`) : Promise.resolve(null)),
    [id],
  );
  if (error) return <ErrorBox error={error} />;
  if (id && !data) return <Loading />;
  return <Builder key={id || 'new'} id={id} initial={data?.config} />;
}

const SHAPES = [[2, 'Round / oval'], [4, 'Rounded'], [8, 'Square-ish'], [12, 'Square']];
const shapeLabel = (n) => SHAPES.reduce((best, s) => (Math.abs(s[0] - n) < Math.abs(best[0] - n) ? s : best))[1];

function Builder({ id, initial }) {
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = !id;
  const [form, setForm] = useState(() => toForm(initial || template('cricket', 'New Ground')));
  const [selected, setSelected] = useState(() => form.stands[0]?.uid || null);
  const [idTouched, setIdTouched] = useState(false);
  const [tab, setTab] = useState('builder');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [layout, setLayout] = useState(null);
  const [layoutError, setLayoutError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [preview, setPreview] = useState(null);

  const config = useMemo(() => toConfig(form), [form]);

  // Recompute the seat layout shortly after each change (it takes ~50–150 ms)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setLayout(config.stands.length ? computeLayout(config) : null);
        setLayoutError('');
      } catch (err) {
        setLayoutError(err.message);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [config]);

  const patch = (p) => setForm((f) => ({ ...f, ...p }));
  const setField = (k, v) => setForm((f) => ({ ...f, field: { ...f.field, [k]: v } }));
  const setExtras = (p) => setForm((f) => ({ ...f, extras: { ...f.extras, ...p } }));
  const updateStand = useCallback((next) => setForm((f) => ({ ...f, stands: f.stands.map((s) => (s.uid === next.uid ? next : s)) })), []);

  const setName = (name) => setForm((f) => ({ ...f, name, id: isNew && !idTouched ? slugify(name) : f.id }));

  const chooseSport = (sport) => {
    if (sport === form.sport) return;
    if (isNew) {
      setForm((f) => ({
        ...f, sport, field: { ...FIELD_DEFAULTS[sport] }, extras: { ...f.extras, indoor: sport === 'basketball', scoreboard: sport === 'basketball' },
      }));
    } else {
      patch({ sport });
    }
  };

  const useTemplate = () => {
    if (form.stands.length && !window.confirm(`Replace all stands with a typical ${form.sport} layout?`)) return;
    const t = toForm(template(form.sport, form.name || 'New Ground'));
    setForm((f) => ({ ...t, raw: f.raw, id: f.id, name: f.name, city: f.city, country: f.country }));
    setSelected(t.stands[0]?.uid || null);
  };

  const addStand = () => {
    const arc = freeArc(form.stands);
    if (!arc) {
      toast('There is no free space left around the ground. Make another stand narrower first.', 'error');
      return;
    }
    const s = newStand(form, arc.from, arc.to, `${direction(midAngle(arc.from, arc.to))} Stand`);
    setForm((f) => ({ ...f, stands: [...f.stands, s] }));
    setSelected(s.uid);
  };

  const deleteStand = (stand) => {
    if (!window.confirm(`Delete "${stand.name}"?`)) return;
    setForm((f) => ({
      ...f,
      stands: f.stands.filter((s) => s.uid !== stand.uid),
      extras: { ...f.extras, screens: f.extras.screens.filter((sc) => sc.standId !== stand.id) },
    }));
    setSelected((cur) => (cur === stand.uid ? form.stands.find((s) => s.uid !== stand.uid)?.uid || null : cur));
  };

  const moveEnd = useCallback((uid, end, angle) => {
    setForm((f) => ({
      ...f,
      stands: f.stands.map((s) => {
        if (s.uid !== uid) return s;
        const next = { ...s, [end]: norm(angle) };
        const w = arcWidth(next.from, next.to);
        return w < 4 || w > 350 ? s : next;
      }),
    }));
  }, []);

  // ---- Checks shown before saving ------------------------------------------------------------
  const overlapping = useMemo(() => {
    const byId = new Map((layout?.stands || []).map((ls) => [ls.id, ls]));
    return overlaps(form.stands, (s) => {
      const ls = byId.get(s.id);
      return ls?.tiers.length ? [ls.tiers[0].d0 - ls.tiers[0].t.depth / 2, ls.dEnd] : null;
    });
  }, [form.stands, layout]);
  const problems = [];
  const warnings = [];
  if (!form.name.trim()) problems.push('Give the stadium a name.');
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(form.id)) problems.push('The stadium ID must use lowercase letters, numbers and dashes.');
  if (!form.stands.length) problems.push('Add at least one stand.');
  for (const s of form.stands) {
    if (!s.name.trim()) problems.push('Every stand needs a name.');
    if (s.levels.some((l) => !(Number(l.capacity) > 0))) problems.push(`"${s.name}" has a level with no seats.`);
  }
  if (layoutError) problems.push(`The layout could not be built: ${layoutError}`);
  if (overlapping.size) warnings.push('Some stands overlap (red outline). Drag their ends apart on the map.');
  if (layout) {
    for (const ls of layout.stands) {
      const fs = form.stands.find((s) => s.id === ls.id);
      const wanted = fs?.levels.reduce((n, l) => n + (Number(l.capacity) || 0), 0) || 0;
      if (ls.seats.length < wanted) warnings.push(`"${fs.name}" only fits ${ls.seats.length.toLocaleString()} of ${wanted.toLocaleString()} seats.`);
    }
  }
  const total = layout?.seats.length || 0;

  async function save(force = false) {
    setSaveError('');
    if (problems.length) {
      setSaveError(problems[0]);
      return;
    }
    setSaving(true);
    try {
      await adminApi(isNew ? '/stadiums' : `/stadiums/${encodeURIComponent(id)}${force ? '?force=1' : ''}`, {
        method: isNew ? 'POST' : 'PUT', body: { config },
      });
      toast(isNew ? 'Stadium created' : 'Stadium saved');
      if (isNew) navigate(`/admin/stadiums/${config.id}`, { replace: true });
      else setForm((f) => ({ ...f, raw: config, stands: f.stands.map((s) => ({ ...s, isNew: false })) }));
    } catch (err) {
      if (err.status === 409 && err.data?.missing
        && window.confirm(`${err.message}.\n\nTickets already sold for those seats would point at seats that no longer exist. Save anyway?`)) {
        setSaving(false);
        save(true);
        return;
      }
      setSaveError(err.message);
    }
    setSaving(false);
  }

  async function remove() {
    if (!window.confirm(`Delete stadium "${form.name}"? This cannot be undone.`)) return;
    try {
      await adminApi(`/stadiums/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Stadium deleted');
      navigate('/admin/stadiums');
    } catch (err) { toast(err.message, 'error'); }
  }

  const openJson = () => {
    setJsonText(JSON.stringify(config, null, 2));
    setJsonError('');
    setTab('json');
  };
  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!isNew && parsed.id !== id) throw new Error(`"id" must stay "${id}"`);
      const next = toForm(parsed);
      setForm(next);
      setSelected(next.stands[0]?.uid || null);
      setTab('builder');
    } catch (err) {
      setJsonError(err.message);
    }
  };

  const sel = form.stands.find((s) => s.uid === selected);
  const selLayout = sel && layout?.stands.find((ls) => ls.id === sel.id);
  const closePreview = useCallback(() => setPreview(null), []);

  return (
    <>
      <Link className="backlink" to="/admin/stadiums">← Stadiums</Link>
      <div className="head">
        <div>
          <h1>{isNew ? 'New stadium' : form.name || 'Stadium'}</h1>
          <p>{isNew ? 'Fill in the steps below. The map on the right updates as you go.' : 'Change anything below, then save.'}</p>
        </div>
        <div className="row-actions">
          <div className="tabs">
            <button type="button" className={tab === 'builder' ? 'on' : ''} onClick={() => setTab('builder')}>Builder</button>
            <button type="button" className={tab === 'json' ? 'on' : ''} onClick={openJson}>Advanced (JSON)</button>
          </div>
          {!isNew && <button type="button" className="btn danger" onClick={remove}>Delete stadium</button>}
        </div>
      </div>

      {tab === 'json' ? (
        <div className="box"><h2>Advanced: layout JSON</h2><div className="pad">
          <textarea className="code" spellCheck={false} value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
          <div className="form-error">{jsonError}</div>
          <div className="row-actions">
            <button type="button" className="btn primary" onClick={applyJson}>Apply to builder</button>
            <button type="button" className="btn" onClick={() => setTab('builder')}>Cancel</button>
            <span className="muted small">Fields the builder doesn&apos;t show are kept as they are.</span>
          </div>
        </div></div>
      ) : (
        <div className="builder">
          <div className="builder-form">
            {/* 1. Basics */}
            <div className="box"><h2><span className="step">1</span>Basics</h2><div className="pad">
              <div className="grid">
                <label className="f wide">Stadium name
                  <input value={form.name} maxLength={100} placeholder="e.g. National Stadium Karachi" onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="f">City<input value={form.city} maxLength={80} onChange={(e) => patch({ city: e.target.value })} /></label>
                <label className="f">Country<input value={form.country} maxLength={80} onChange={(e) => patch({ country: e.target.value })} /></label>
                <label className="f">Stadium ID (used in links)
                  <input value={form.id} disabled={!isNew} maxLength={63}
                    onChange={(e) => { setIdTouched(true); patch({ id: slugify(e.target.value) }); }} />
                </label>
              </div>
              <div className="f" style={{ marginTop: 14 }}>Sport
                <div className="sport-pick">
                  {SPORTS.map((s) => (
                    <button type="button" key={s.id} className={form.sport === s.id ? 'on' : ''} onClick={() => chooseSport(s.id)}>
                      <SportIcon id={s.id} /><b>{s.label}</b><span>{s.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="row-actions" style={{ marginTop: 12 }}>
                <button type="button" className="btn sm" onClick={useTemplate}>Start from a typical {form.sport} layout</button>
                <span className="muted small">Replaces the stands with a ready-made set you can then adjust.</span>
              </div>
            </div></div>

            {/* 2. Playing area */}
            <div className="box"><h2><span className="step">2</span>Playing area</h2><div className="pad grid">
              <label className="f">Length: <b>{form.field.length} m</b>
                <input type="range" min={form.sport === 'basketball' ? 30 : 90} max={form.sport === 'basketball' ? 50 : 180} value={form.field.length} onChange={(e) => setField('length', Number(e.target.value))} />
              </label>
              <label className="f">Width: <b>{form.field.width} m</b>
                <input type="range" min={form.sport === 'basketball' ? 18 : 60} max={form.sport === 'basketball' ? 36 : 170} value={form.field.width} onChange={(e) => setField('width', Number(e.target.value))} />
              </label>
              <label className="f">Shape: <b>{shapeLabel(form.field.superellipse || 2)}</b>
                <input type="range" min="2" max="12" step="0.5" value={form.field.superellipse || 2} onChange={(e) => setField('superellipse', Number(e.target.value))} />
              </label>
              <div className="f" style={{ alignSelf: 'end' }}>
                <button type="button" className="btn sm" onClick={() => setForm((f) => ({ ...f, field: { ...f.field, ...FIELD_DEFAULTS[f.sport] } }))}>Use typical {form.sport} size</button>
              </div>
            </div></div>

            {/* 3. Stands */}
            <div className="box"><h2><span className="step">3</span>Stands <span className="muted small">click one to edit it</span></h2><div className="pad">
              <div className="stand-list">
                {form.stands.map((s) => {
                  const ls = layout?.stands.find((x) => x.id === s.id);
                  return (
                    <button type="button" key={s.uid} className={`stand-chip${s.uid === selected ? ' on' : ''}${overlapping.has(s.uid) ? ' bad' : ''}`} onClick={() => setSelected(s.uid)}>
                      <b>{s.name || 'Unnamed'}</b>
                      <span>{direction(midAngle(s.from, s.to))} · {(ls?.seats.length ?? 0).toLocaleString()} seats</span>
                    </button>
                  );
                })}
                <button type="button" className="stand-chip add" onClick={addStand}><b>+ Add stand</b><span>in the largest free gap</span></button>
              </div>
              {sel ? (
                <StandEditor
                  key={sel.uid}
                  stand={sel}
                  sport={form.sport}
                  layoutStand={selLayout}
                  onChange={updateStand}
                  onRename={(name) => updateStand(renameStand(form, sel, name))}
                  onDelete={() => deleteStand(sel)}
                />
              ) : <p className="muted">No stands yet. Click &quot;Add stand&quot;.</p>}
            </div></div>

            {/* 4. Extras */}
            <div className="box"><h2><span className="step">4</span>Extras</h2><div className="pad">
              <div className="grid">
                <label className="f">Floodlight towers
                  <input type="number" min="0" max="12" value={form.extras.floodlights} onChange={(e) => setExtras({ floodlights: Math.max(0, Number(e.target.value) || 0) })} />
                </label>
                <div className="f checks">
                  {form.sport === 'cricket' && <label className="check"><input type="checkbox" checked={form.extras.sightScreens} onChange={(e) => setExtras({ sightScreens: e.target.checked })} /> Sight screens at both ends</label>}
                  <label className="check"><input type="checkbox" checked={form.extras.indoor} onChange={(e) => setExtras({ indoor: e.target.checked })} /> Indoor (full roof)</label>
                  <label className="check"><input type="checkbox" checked={form.extras.scoreboard} onChange={(e) => setExtras({ scoreboard: e.target.checked })} /> Hanging scoreboard</label>
                </div>
              </div>
              <h3 className="sub-h">Big screens</h3>
              {form.extras.screens.map((sc) => (
                <div className="screen-row" key={sc.uid}>
                  <label className="f">Above stand
                    <select value={sc.standId} onChange={(e) => setExtras({ screens: form.extras.screens.map((x) => (x.uid === sc.uid ? { ...x, standId: e.target.value } : x)) })}>
                      <option value="">Choose a stand</option>
                      {form.stands.map((s) => <option key={s.uid} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                  <label className="f">Width (ft)<input type="number" min="5" max="200" value={sc.width} onChange={(e) => setExtras({ screens: form.extras.screens.map((x) => (x.uid === sc.uid ? { ...x, width: Number(e.target.value) } : x)) })} /></label>
                  <label className="f">Height (ft)<input type="number" min="5" max="100" value={sc.height} onChange={(e) => setExtras({ screens: form.extras.screens.map((x) => (x.uid === sc.uid ? { ...x, height: Number(e.target.value) } : x)) })} /></label>
                  <button type="button" className="btn sm danger" onClick={() => setExtras({ screens: form.extras.screens.filter((x) => x.uid !== sc.uid) })}>Remove</button>
                </div>
              ))}
              <button type="button" className="btn sm" onClick={() => setExtras({ screens: [...form.extras.screens, { uid: `s${Date.now()}`, raw: null, standId: sel?.id || form.stands[0]?.id || '', width: 60, height: 24 }] })}>+ Add big screen</button>
            </div></div>
          </div>

          {/* Live map + save */}
          <aside className="builder-side">
            <div className="box">
              <h2>Live map</h2>
              <div className="map-wrap">
                <MapPreview layout={layout} form={form} selected={selected} overlapping={overlapping} onSelect={setSelected} onMoveEnd={moveEnd} />
              </div>
              <div className="pad">
                <div className="muted small">TOTAL SEATS</div>
                <div className="big">{total.toLocaleString()}</div>
                <div className="muted small">{form.stands.length} stand{form.stands.length === 1 ? '' : 's'}</div>
                {(problems.length > 0 || warnings.length > 0) && (
                  <ul className="checks-list">
                    {[...new Set(problems)].map((p) => <li key={p} className="bad">{p}</li>)}
                    {[...new Set(warnings)].map((w) => <li key={w} className="warn">{w}</li>)}
                  </ul>
                )}
                <div className="form-error">{saveError}</div>
                <div className="row-actions">
                  <button type="button" className="btn" disabled={!layout || !!layoutError} onClick={() => setPreview(config)}>Preview in 3D</button>
                  <button type="button" className="btn primary" disabled={saving} onClick={() => save(false)}>
                    {saving ? 'Saving…' : isNew ? 'Create stadium' : 'Save changes'}
                  </button>
                </div>
                {!isNew && <p className="note">Changing stands or seat numbers changes seat IDs. Saving is refused if tickets already sold would lose their seats.</p>}
              </div>
            </div>
          </aside>
        </div>
      )}

      {preview && <Preview3D config={preview} onClose={closePreview} />}
    </>
  );
}
