// Small shared pieces for admin pages.
import {
  createContext, useCallback, useContext, useEffect, useState,
} from 'react';
import { useNavigate } from 'react-router';
import { Spinner } from '../components/Spinner.jsx';

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const show = useCallback((text, kind = 'ok') => setToast({ text, kind, at: Date.now() }), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`}>{toast.text}</div>}
    </ToastContext.Provider>
  );
}

export function StatusPill({ status }) {
  const cls = { scheduled: 'green', confirmed: 'green', cancelled: 'red' }[status] || '';
  return <span className={`pill ${cls}`}>{status}</span>;
}

export function Loading() {
  return <Spinner text="Loading…" />;
}

export function ErrorBox({ error }) {
  return (
    <div className="box"><div className="pad">
      <b>Could not load this page.</b>
      <p className="muted">{error.message}</p>
    </div></div>
  );
}

// Table row that navigates on click.
export function LinkRow({ to, children }) {
  const navigate = useNavigate();
  return <tr className="click" onClick={() => navigate(to)}>{children}</tr>;
}
