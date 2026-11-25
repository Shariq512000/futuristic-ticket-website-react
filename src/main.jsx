import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router';
import './styles/site.css';
import SiteLayout from './site/SiteLayout.jsx';
import Home from './site/Home.jsx';
import SportPage from './site/SportPage.jsx';
import { Spinner } from './components/Spinner.jsx';

// Heavy parts load on demand: three.js only on the match page, admin only for admins.
const MatchPage = lazy(() => import('./site/MatchPage.jsx'));
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));

function NotFound() {
  return (
    <section className="hero">
      <h1>Page not found</h1>
      <p><Link to="/">Back to all sports</Link></p>
    </section>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="page"><Spinner text="Loading…" /></div>}>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route index element={<Home />} />
            <Route path="sport/:id" element={<SportPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="match/:id" element={<MatchPage />} />
          <Route path="admin/*" element={<AdminApp />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
