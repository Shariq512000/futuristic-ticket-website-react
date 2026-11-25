import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router';

export default function SiteLayout() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <>
      <header className="top">
        <Link className="brand" to="/">MATCH <b>TICKETS</b></Link>
      </header>
      <main className="page">
        <Outlet />
        <footer className="foot">Sample fixtures, venues and prices for demonstration. No real payments are taken.</footer>
      </main>
    </>
  );
}
