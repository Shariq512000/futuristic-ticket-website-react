import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtDate, money, shortId } from '../lib/format.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Demo checkout: the seat is already held on the server (10 minutes).
// Confirming turns the hold into an order. No payment is taken.
export default function Checkout({
  match, hold, order, onCancel, onConfirmed, onExpired, onDone,
}) {
  const cur = match.currency;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [left, setLeft] = useState(() => secondsLeft(hold));
  const nameRef = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  useEffect(() => {
    if (order) return undefined;
    const t = setInterval(() => {
      const s = secondsLeft(hold);
      setLeft(s);
      if (s <= 0) onExpired();
    }, 1000);
    return () => clearInterval(t);
  }, [hold, order, onExpired]);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || !EMAIL.test(email.trim())) {
      setError('Please enter your name and a valid email.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      onConfirmed(await api.order(hold.holdId, { name: name.trim(), email: email.trim() }));
    } catch (err) {
      if (err.status === 410) onExpired();
      else {
        setError(err.message);
        setSubmitting(false);
      }
    }
  }

  if (order) {
    return (
      <div className="modal">
        <div className="checkout">
          <h3>Booking confirmed</h3>
          <div className="sub">Order {shortId(order.id)} · {order.match.title}</div>
          <dl>
            {order.seats.map((l) => <Line key={l.seatId} label={l.label} value={money(l.price, cur)} />)}
            <dt className="total">Total</dt><dd className="total">{money(order.total, cur)}</dd>
          </dl>
          <div className="actions"><button type="button" className="pill-btn buy" onClick={onDone}>Done</button></div>
          <div className="demo">Demo booking. No payment was taken.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="checkout" onSubmit={submit} noValidate>
        <h3>Checkout</h3>
        <div className="sub">{match.title} · {fmtDate(match.date)} · {match.venue?.name}</div>
        <dl>
          {hold.seats.map((l) => <Line key={l.seatId} label={l.label} value={money(l.price, cur)} />)}
          <dt>Service fee</dt><dd>{money(hold.fee, cur)}</dd>
          <dt className="total">Total</dt><dd className="total">{money(hold.total, cur)}</dd>
        </dl>
        <div className="hold">Seat held for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</div>
        <label>Full name
          <input ref={nameRef} name="name" autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>Email
          <input name="email" type="email" autoComplete="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <div className="form-error">{error}</div>
        <div className="actions">
          <button type="button" className="pill-btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="pill-btn buy" disabled={submitting}>{submitting ? 'Confirming…' : 'Confirm purchase'}</button>
        </div>
        <div className="demo">Demo checkout. No payment is taken.</div>
      </form>
    </div>
  );
}

function Line({ label, value }) {
  return (<><dt>{label}</dt><dd>{value}</dd></>);
}

function secondsLeft(hold) {
  return Math.max(0, Math.round((new Date(hold.expiresAt) - Date.now()) / 1000));
}
