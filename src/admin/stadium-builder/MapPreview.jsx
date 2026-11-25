// Top-down map of the stadium, drawn from the real seat layout.
// Click a stand to select it; drag the round handles to move its ends.
import { useRef } from 'react';
import { arcPoints, nearestIndex } from '../../../shared/layout.js';
import { norm } from './convert.js';

const COLORS = ['#2f86e0', '#2fa35f', '#8b5cf6', '#e0a43a', '#e2574c', '#17a2b8', '#d35fb7', '#7fb33a', '#5c7cfa', '#f08c3a'];
const FIELD_FILL = { cricket: '#2f6b35', football: '#2f6b35', basketball: '#c99a6b' };

export default function MapPreview({
  layout, form, selected, overlapping, onSelect, onMoveEnd,
}) {
  const svgRef = useRef(null);
  const drag = useRef(null);
  if (!layout) return <div className="map-empty">Add a stand to see the map.</div>;

  const { base, a, b, maxD } = layout;
  const R = Math.max(a, b) + Math.max(maxD, 10) + 14;
  const pts = (P, step = 4) => {
    const out = [];
    for (let i = 0; i < P.n; i += step) out.push(`${P.x[i].toFixed(1)},${P.z[i].toFixed(1)}`);
    out.push(`${P.x[P.n - 1].toFixed(1)},${P.z[P.n - 1].toFixed(1)}`);
    return out;
  };
  const all = [...Array(base.M).keys(), 0];
  const field = pts(arcPoints(base, all, 0), 8).join(' ');
  const font = R / 26;

  // Position on the map for an angle, d metres out from the field edge
  const at = (angle, d) => {
    const k = nearestIndex(base, norm(angle));
    return [base.px[k] + base.nx[k] * d, base.pz[k] + base.nz[k] * d];
  };

  const toAngle = (e) => {
    const svg = svgRef.current;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return norm((Math.atan2(q.y, q.x) * 180) / Math.PI);
  };
  const startDrag = (e, uid, end) => {
    e.stopPropagation();
    drag.current = { uid, end };
    try { svgRef.current.setPointerCapture(e.pointerId); } catch { /* moves still reach the svg */ }
  };
  const moveDrag = (e) => {
    if (!drag.current) return;
    onMoveEnd(drag.current.uid, drag.current.end, toAngle(e));
  };
  const endDrag = () => { drag.current = null; };

  const sel = form.stands.find((s) => s.uid === selected);
  const selLayout = sel && layout.stands.find((ls) => ls.id === sel.id);
  const handleD = (selLayout?.dEnd ?? 10) + 4;

  return (
    <svg
      ref={svgRef}
      className="map"
      viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="img"
      aria-label="Top-down map of the stadium"
    >
      <polygon points={field} fill={FIELD_FILL[form.sport] || '#2f6b35'} stroke="rgba(255,255,255,.35)" strokeWidth={R / 300} />
      {form.sport === 'cricket' && <rect x={-12} y={-1.5} width={24} height={3} fill="#cfb784" />}
      {form.sport === 'football' && (
        <g stroke="rgba(255,255,255,.7)" strokeWidth={R / 400} fill="none">
          <rect x={-52.5} y={-34} width={105} height={68} />
          <line x1={0} y1={-34} x2={0} y2={34} />
          <circle r={9.15} />
        </g>
      )}

      {layout.stands.map((ls, i) => {
        const fs = form.stands.find((s) => s.id === ls.id);
        if (!fs || !ls.tiers.length) return null;
        const inner = pts(arcPoints(base, ls.idx, ls.tiers[0].d0 - 0.6));
        const outer = pts(arcPoints(base, ls.idx, ls.dEnd)).reverse();
        const isSel = fs.uid === selected;
        const bad = overlapping.has(fs.uid);
        const [lx, ly] = at((fs.from + ((norm(fs.to) - norm(fs.from) + 360) % 360) / 2), (ls.tiers[0].d0 + ls.dEnd) / 2);
        return (
          <g key={ls.id} onClick={() => onSelect(fs.uid)} style={{ cursor: 'pointer' }}>
            <polygon
              points={[...inner, ...outer].join(' ')}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={isSel ? 0.95 : 0.55}
              stroke={bad ? '#ff5a52' : isSel ? '#f5c451' : 'rgba(0,0,0,.4)'}
              strokeWidth={(isSel || bad ? 2.2 : 0.8) * (R / 300)}
            />
            <text x={lx} y={ly} fontSize={font} textAnchor="middle" dominantBaseline="middle" fill="#fff" stroke="rgba(0,0,0,.6)" strokeWidth={font / 6} paintOrder="stroke">
              {fs.name}
            </text>
          </g>
        );
      })}

      {sel && ['from', 'to'].map((end) => {
        const [x, y] = at(sel[end], handleD);
        return (
          <g key={end}>
            <circle
              cx={x} cy={y} r={font * 0.75} fill="#f5c451" stroke="#241a02" strokeWidth={font / 8}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => startDrag(e, sel.uid, end)}
            >
              <title>{`Drag to move the ${end === 'from' ? 'start' : 'end'} of ${sel.name}`}</title>
            </circle>
          </g>
        );
      })}

      {[['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]].map(([l, dx, dy]) => (
        <text key={l} x={dx * (R - font)} y={dy * (R - font)} fontSize={font * 1.1} fill="#8a93a3" textAnchor="middle" dominantBaseline="middle" fontWeight="700">{l}</text>
      ))}
    </svg>
  );
}
