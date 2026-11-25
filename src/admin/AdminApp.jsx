// Admin panel (/admin/*): sign-in, dashboard, matches, orders, stadiums, sports.
import { useCallback, useEffect, useState } from 'react';
import {
  Link, NavLink, Navigate, Outlet, Route, Routes, useNavigate,
} from 'react-router';
import './admin.css';
import { adminApi } from '../lib/api.js';
import { ToastProvider, Loading } from './ui.jsx';
import Login from './Login.jsx';
import Dashboard from './Dashboard.jsx';
import Matches from './Matches.jsx';
import MatchForm from './MatchForm.jsx';
import Orders from './Orders.jsx';
import OrderDetail from './OrderDetail.jsx';
import Stadiums from './Stadiums.jsx';
import StadiumBuilder from './stadium-builder/StadiumBuilder.jsx';
import Sports from './Sports.jsx';

const NAV = [['/admin', 'Dashboard', true], ['/admin/matches', 'Matches'], ['/admin/orders', 'Orders'], ['/admin/stadiums', 'Stadiums'], ['/admin/sports', 'Sports']];

export default function AdminApp() {
  const [me, setMe] = useState(undefined); // undefined = checking, null = signed out

  useEffect(() => {
    document.title = 'Admin · Match Tickets';
    adminApi('/me').then(setMe, () => setMe(null));
    const onUnauthorized = () => setMe(null);
    window.addEventListener('admin:unauthorized', onUnauthorized);
    return () => {
      window.removeEventListener('admin:unauthorized', onUnauthorized);
      document.title = 'Match Tickets';
    };
  }, []);

  if (me === undefined) return <div className="adm"><div className="main"><Loading /></div></div>;

  return (
    <div className="adm">
      <ToastProvider>
        <Routes>
          <Route path="login" element={me ? <Navigate to="/admin" replace /> : <Login onLogin={setMe} />} />
          <Route element={me ? <Layout me={me} onLogout={() => setMe(null)} /> : <Navigate to="/admin/login" replace />}>
            <Route index element={<Dashboard />} />
            <Route path="matches" element={<Matches />} />
            <Route path="matches/new" element={<MatchForm key="new" />} />
            <Route path="matches/:id" element={<MatchForm />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/:id" element={<OrderDetail />} />
            <Route path="stadiums" element={<Stadiums />} />
            <Route path="stadiums/new" element={<StadiumBuilder key="new" />} />
            <Route path="stadiums/:id" element={<StadiumBuilder />} />
            <Route path="sports" element={<Sports />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>
        </Routes>
      </ToastProvider>
    </div>
  );
}

function Layout({ me, onLogout }) {
  const navigate = useNavigate();
  const logout = useCallback(async () => {
    await adminApi('/logout', { method: 'POST' }).catch(() => {});
    onLogout();
    navigate('/admin/login');
  }, [navigate, onLogout]);
  return (
    <div className="shell">
      <aside className="side">
        <Link className="brand" to="/admin">MATCH <b>TICKETS</b><span>ADMIN</span></Link>
        <nav className="nav">
          {NAV.map(([to, label, end]) => <NavLink key={to} to={to} end={end}>{label}</NavLink>)}
        </nav>
        <div className="who">
          <div><b>{me.name}</b><br />{me.email}</div>
          <div className="row-actions">
            <a className="btn sm" href="/" target="_blank" rel="noopener noreferrer">View site</a>
            <button type="button" className="btn sm" onClick={logout}>Sign out</button>
          </div>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}
