import {
  useCallback, useEffect, useReducer, useRef, useState,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { StadiumViewer } from '../viewer/StadiumViewer.js';
import { api } from '../lib/api.js';
import { fmtDate, money, sportName } from '../lib/format.js';
import Checkout from './Checkout.jsx';

const REFRESH_MS = 15000;

export default function MatchPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const stageRef = useRef(null);
  const viewerRef = useRef(null);
  const holdRef = useRef(null);
  const [, rerender] = useReducer((x) => x + 1, 0);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState(null);
  const [hint, setHint] = useState(false);
  const [toast, setToast] = useState(null);
  const [checkout, setCheckout] = useState(null); // { hold, seat, order? }
  const [buying, setBuying] = useState(false);

  const showToast = useCallback((text, kind = 'ok') => setToast({ text, kind, at: Date.now() }), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  const releaseHold = useCallback(() => {
    const h = holdRef.current;
    holdRef.current = null;
    if (h) api.release(h.holdId).catch(() => {});
  }, []);

  // ---- three.js scene: created once for this page ----------------------------------
  useEffect(() => {
    const viewer = new StadiumViewer(stageRef.current, {
      onChange: rerender,
      onHover: (info, x, y) => setHover(info ? { info, x, y } : null),
      onSeatArrived: () => {
        setHint(true);
        setTimeout(() => setHint(false), 2200);
      },
    });
    viewerRef.current = viewer;
    window.tickets = { get viewer() { return viewerRef.current; }, get hold() { return holdRef.current; } };
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  const refresh = useCallback(async (matchId) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    try {
      const availability = await api.availability(matchId, holdRef.current?.holdId);
      if (viewerRef.current !== viewer || viewer.match?.id !== matchId) return;
      viewer.applyAvailability(availability);
      const { mode, selected, focus } = viewer.state;
      if (mode === 'seat' && selected?.taken && !holdRef.current) {
        showToast('Sorry, that seat was just sold.', 'error');
        viewer.goStand(focus);
      }
    } catch (err) {
      console.warn('Availability refresh failed:', err.message);
    }
  }, [showToast]);

  // ---- Load the match (and its stadium) whenever the URL changes ----------------------
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    setCheckout(null);
    api.match(id)
      .then(async (d) => {
        if (!current || !viewerRef.current) return;
        setData(d);
        viewerRef.current.load(d.match, d.stadium);
        await refresh(d.match.id);
      })
      .catch((err) => current && setError(err))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
      releaseHold();
    };
  }, [id, refresh, releaseHold]);

  // Live availability while the page is open
  useEffect(() => {
    if (!data) return undefined;
    const t = setInterval(() => refresh(data.match.id), REFRESH_MS);
    return () => clearInterval(t);
  }, [data, refresh]);

  // Free the seat if the tab closes mid-checkout (best effort)
  useEffect(() => {
    const onHide = () => {
      if (holdRef.current) navigator.sendBeacon?.(`/api/holds/${encodeURIComponent(holdRef.current.holdId)}/release`);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  const closeCheckout = useCallback(() => {
    releaseHold();
    setCheckout(null);
  }, [releaseHold]);

  // Esc: close checkout, else step back (seat → stand → overview → match list)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (checkout) {
        if (!checkout.order) closeCheckout();
        return;
      }
      if (viewerRef.current && !viewerRef.current.back() && data) navigate(`/sport/${data.match.sport}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checkout, closeCheckout, data, navigate]);

  // ---- Buying --------------------------------------------------------------------------------
  async function buy() {
    const viewer = viewerRef.current;
    const seat = viewer.state.selected;
    setBuying(true);
    try {
      const hold = await api.hold(data.match.id, [seat.id]);
      holdRef.current = hold;
      setCheckout({ hold, seat });
    } catch (err) {
      if (err.status === 409) {
        showToast('Sorry, that seat was just taken. Pick another one.', 'error');
        await refresh(data.match.id);
        viewer.goStand(seat.stand.id);
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      setBuying(false);
    }
  }

  function onConfirmed(order) {
    holdRef.current = null;
    viewerRef.current?.markTaken(checkout.seat);
    setCheckout((c) => ({ ...c, order }));
  }

  function onDone() {
    const viewer = viewerRef.current;
    setCheckout(null);
    // Leave the seat view first so the refresh doesn't report the buyer's own seat as "just sold"
    if (viewer.state.focus) viewer.goStand(viewer.state.focus);
    else viewer.resetFocus('overview');
    showToast('Booked. See you at the match! (demo)');
    refresh(data.match.id);
  }

  // Stable identity so the checkout's countdown timer isn't restarted on every render
  const onExpired = useCallback(() => {
    closeCheckout();
    showToast('Your hold expired. The seat has been released.', 'error');
  }, [closeCheckout, showToast]);

  // ---- Render ----------------------------------------------------------------------------------
  const viewer = viewerRef.current;
  const match = data?.match;
  const vs = viewer?.state;
  const currency = match?.currency;

  let bar = null;
  if (error) {
    bar = (
      <>
        <div className="txt"><b>{error.status === 404 ? 'Match not found' : 'Could not load this match'}</b><span>{error.message}</span></div>
        <button type="button" className="pill-btn" onClick={() => navigate('/')}>Back to matches</button>
      </>
    );
  } else if (match && viewer?.stadium && vs) {
    if (vs.mode === 'overview') {
      const { total, left } = viewer.totals;
      bar = (
        <div className="txt"><b>Pick a stand</b>
          <span>{left.toLocaleString()} of {total.toLocaleString()} seats left · hover for prices · click to fly in</span></div>
      );
    } else if (vs.mode === 'stand') {
      const st = viewer.stadium.stands.get(vs.focus);
      bar = (
        <>
          <button type="button" className="pill-btn" onClick={() => viewer.goOverview()}>← All stands</button>
          <div className="txt"><b>{st.name}</b><span>{standInfo(st, currency)} · click a seat to see its view</span></div>
        </>
      );
    } else if (vs.selected) {
      const s = vs.selected;
      bar = (
        <>
          <div className="txt"><b>{s.label}</b><span>{s.stand.name} · {money(s.price, currency)}</span></div>
          <button type="button" className="pill-btn" onClick={() => viewer.goStand(vs.focus)}>← Other seats</button>
          <button type="button" className="pill-btn buy" disabled={buying || s.taken} onClick={buy}>
            {buying ? 'Holding seat…' : s.taken ? 'Sold' : 'Buy ticket →'}
          </button>
        </>
      );
    }
  }

  return (
    <div className="match-page">
      <div className="stage" ref={stageRef} />

      <header className="top overlay">
        <Link className="brand" to="/">MATCH <b>TICKETS</b></Link>
        {match && <Link className="crumb" to={`/sport/${match.sport}`}>← {sportName(match.sport)}</Link>}
        {match && <div className="event">{match.title} · <b>{fmtDate(match.date)}</b> · {match.venue?.name}</div>}
      </header>

      {loading && !error && <div className="loading-pill"><span className="spinner" />Loading stadium…</div>}

      {viewer?.bands?.length > 0 && vs?.mode !== 'seat' && !error && (
        <aside className="legend">
          <h4>PRICES · THIS MATCH</h4>
          {viewer.bands.map((b) => (
            <div className="row" key={b.color}>
              <i style={{ background: b.color }} />
              {b.min === b.max ? money(b.min, currency) : `${money(b.min, currency)} – ${b.max.toLocaleString('en-US')}`}
            </div>
          ))}
          <div className="row"><i style={{ background: '#353941' }} />Sold</div>
        </aside>
      )}

      {hover && <Tooltip {...hover} currency={currency} />}
      {hint && <div className="hint">Drag to look around</div>}
      {bar && <nav className="bar">{bar}</nav>}
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}

      {checkout && (
        <Checkout
          match={match}
          hold={checkout.hold}
          order={checkout.order}
          onCancel={closeCheckout}
          onConfirmed={onConfirmed}
          onExpired={onExpired}
          onDone={onDone}
        />
      )}
    </div>
  );
}

function standInfo(st, currency) {
  return st.available
    ? `${st.available.toLocaleString()} of ${st.capacity.toLocaleString()} seats left · from ${money(st.minPrice, currency)}`
    : 'Sold out';
}

function Tooltip({ info, x, y, currency }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x + 16, top: y + 16 });
  useEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.min(x + 16, window.innerWidth - r.width - 8),
      top: Math.min(y + 16, window.innerHeight - r.height - 8),
    });
  }, [x, y, info]);
  let title = info.stand.name;
  let sub = standInfo(info.stand, currency);
  if (info.kind === 'seat') {
    title = info.seat.label;
    sub = info.seat.taken ? 'Sold' : `${money(info.seat.price, currency)} · Available`;
  } else if (info.kind === 'other') {
    sub = 'Click to view this stand';
  }
  return <div className="tip" ref={ref} style={pos}><b>{title}</b><span>{sub}</span></div>;
}
