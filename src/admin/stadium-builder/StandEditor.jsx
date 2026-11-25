// Editor card for one stand: name, type, position, roof, levels (tiers) and seats.
import {
  LEVEL_KINDS, arcWidth, direction, midAngle, newLevel, norm,
} from './convert.js';

export default function StandEditor({
  stand, layoutStand, onChange, onRename, onDelete, sport,
}) {
  const set = (patch) => onChange({ ...stand, ...patch });
  const setLevel = (uid, patch) => set({ levels: stand.levels.map((l) => (l.uid === uid ? { ...l, ...patch } : l)) });
  const moveLevel = (i, dir) => {
    const levels = [...stand.levels];
    [levels[i], levels[i + dir]] = [levels[i + dir], levels[i]];
    set({ levels });
  };
  const width = arcWidth(stand.from, stand.to);
  const built = layoutStand?.tiers || [];
  const builtSeats = (i) => layoutStand?.seats.filter((s) => s.tierIndex === i).length;

  // Move the whole stand, or change its width, keeping the other end/centre in place
  const setCentre = (c) => set({ from: norm(c - width / 2), to: norm(c + width / 2) });
  const setWidth = (w) => {
    const c = midAngle(stand.from, stand.to);
    set({ from: norm(c - w / 2), to: norm(c + w / 2) });
  };

  return (
    <div className="stand-editor">
      <div className="grid">
        <label className="f">Stand name
          <input value={stand.name} maxLength={80} onChange={(e) => onRename(e.target.value)} placeholder="e.g. North Stand" />
        </label>
        <label className="f">Type
          <select value={stand.type} onChange={(e) => set({ type: e.target.value })}>
            <option value="stand">Seating stand</option>
            <option value="pavilion">Main building (pavilion)</option>
          </select>
        </label>
        {stand.type === 'pavilion' && (
          <label className="f">Building floors
            <input type="number" min="1" max="12" value={stand.floors} onChange={(e) => set({ floors: e.target.value })} />
          </label>
        )}
      </div>

      <div className="pos">
        <label className="f">Position around the ground: <b>{direction(midAngle(stand.from, stand.to))}</b> side
          <input type="range" min="0" max="359" value={Math.round(midAngle(stand.from, stand.to))} onChange={(e) => setCentre(Number(e.target.value))} />
        </label>
        <label className="f">How far it wraps around: <b>{Math.round(width)}°</b> {width < 20 ? '(narrow)' : width > 120 ? '(very wide)' : ''}
          <input type="range" min="6" max="200" value={Math.round(width)} onChange={(e) => setWidth(Number(e.target.value))} />
        </label>
        <p className="note">Tip: drag the yellow dots on the map to move each end of this stand.</p>
      </div>

      <div className="row-actions" style={{ margin: '4px 0 14px' }}>
        <label className="check"><input type="checkbox" checked={stand.roof} onChange={(e) => set({ roof: e.target.checked })} /> Has a roof</label>
        <label className="f inline">Distance from the {sport === 'basketball' ? 'court' : 'field'} (m)
          <input type="number" step="0.5" min="-4" max="30" value={stand.frontGap} onChange={(e) => set({ frontGap: e.target.value })} style={{ width: 80 }} />
        </label>
      </div>

      <h3 className="sub-h">Levels <span className="muted small">bottom to top</span></h3>
      <div className="levels">
        {stand.levels.map((l, i) => {
          const tier = built[i];
          const seats = builtSeats(i);
          const short = seats != null && Number(l.capacity) > 0 && seats < Number(l.capacity);
          return (
            <div className="level" key={l.uid}>
              <div className="level-n">{i + 1}</div>
              <label className="f">Seat type
                <select value={l.kind} onChange={(e) => setLevel(l.uid, { kind: e.target.value })}>
                  {LEVEL_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              </label>
              <label className="f">Name (optional)
                <input value={l.name} maxLength={80} placeholder={i === 0 ? 'e.g. Lower Tier' : 'e.g. Upper Tier'} onChange={(e) => setLevel(l.uid, { name: e.target.value })} />
              </label>
              <label className="f">Seats
                <input type="number" min="1" step="10" value={l.capacity} onChange={(e) => setLevel(l.uid, { capacity: e.target.value })} />
              </label>
              {l.kind === 'boxes' && (
                <label className="f">Number of boxes
                  <input type="number" min="1" max="60" value={l.boxes} onChange={(e) => setLevel(l.uid, { boxes: e.target.value })} />
                </label>
              )}
              <div className="level-info small">
                {tier ? <span className="muted">{tier.rows} row{tier.rows === 1 ? '' : 's'}</span> : <span className="muted">…</span>}
                {short && <span className="warn">Only {seats.toLocaleString()} seats fit: make the stand wider or add a level</span>}
                {tier && tier.rows > 55 && !short && <span className="warn">Very tall ({tier.rows} rows): consider an extra level</span>}
              </div>
              <div className="level-actions">
                <button type="button" className="btn sm" disabled={i === 0} onClick={() => moveLevel(i, -1)} title="Move down">↓</button>
                <button type="button" className="btn sm" disabled={i === stand.levels.length - 1} onClick={() => moveLevel(i, 1)} title="Move up">↑</button>
                <button type="button" className="btn sm danger" disabled={stand.levels.length === 1} onClick={() => set({ levels: stand.levels.filter((x) => x.uid !== l.uid) })}>Remove</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="row-actions" style={{ marginTop: 10 }}>
        <button type="button" className="btn sm" onClick={() => set({ levels: [...stand.levels, newLevel('normal', 2000)] })}>+ Add level</button>
        <span className="muted small">Total in this stand: <b>{(layoutStand?.seats.length ?? 0).toLocaleString()}</b> seats</span>
        <button type="button" className="btn sm danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>Delete stand</button>
      </div>
    </div>
  );
}
