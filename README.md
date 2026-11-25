# Match Tickets (React)

Multi-sport ticketing site with a 3D seat picker, Express + MongoDB backend and an admin panel.
React 19 + React Router + Vite on the front end; the 3D scene uses three.js.

Home (sports) → sport page (upcoming matches) → match page (3D stadium coloured by that match's
prices, live availability) → seat view → 10-minute hold → order (demo: no payment).
Admin panel at `/admin`.

## Running it

1. `npm install`
2. Copy `.env.example` to `.env` and set `MONGODB_URI` (Atlas or local) and `SESSION_SECRET`.
3. Load data (first time only): `npm run seed -- --demo-sales`
4. Create your admin: `npm run create-admin -- --email you@example.com --name "Your Name"`
5. Terminal 1: `npm run server` (API on http://localhost:4000/api). Use `npm run server:watch` to
   auto-restart on server code changes; on Windows it can also restart on unrelated file changes,
   which signs admins out unless `SESSION_SECRET` is set.
6. Terminal 2: `npm run dev` and open the address Vite prints (http://localhost:5173 by default)

Production: `npm run build`, then `npm start` serves the site, admin and API together on port 4000.
If your API runs on another port in development, set `API_PORT` in `.env` (Vite forwards `/api` there).

## Pages (React Router)

| Path | Page |
|---|---|
| `/` | Sports grid + next matches |
| `/sport/:id` | Upcoming matches for a sport, venue filter |
| `/match/:id` | 3D stadium, stand → seat → checkout (lazy-loaded with three.js) |
| `/admin/login` | Admin sign-in |
| `/admin` | Dashboard: revenue, tickets, holds, sales per match, latest orders |
| `/admin/matches`, `/admin/matches/new`, `/admin/matches/:id` | List, create, edit (prices per stand/tier), cancel, delete |
| `/admin/orders`, `/admin/orders/:id` | Search/filter, view buyer, cancel order (seats go back on sale) |
| `/admin/stadiums`, `/admin/stadiums/new`, `/admin/stadiums/:id` | Layout JSON editor with seat-count check |
| `/admin/sports` | Add, rename, reorder, delete |

## Project layout

```
src/
  main.jsx              Router; match page and admin are lazy-loaded
  lib/                  api.js (fetch client), format.js, useAsync.js (data loading hook)
  components/           Spinner, SportIcon
  site/                 SiteLayout, Home, SportPage, MatchCard, MatchPage, Checkout
  viewer/               StadiumViewer.js (three.js scene class), stadium.js (venue builder), textures.js
  admin/                AdminApp (routes + auth), pages, ui.jsx (toast, pills), admin.css (scoped under .adm)
  styles/site.css
shared/layout.js        Seat layout maths used by BOTH the browser and the server
server/                 Express API, Mongoose models, auth, seed and create-admin scripts
stadiums/*.json         Venue layouts      data/*.json   Sports and sample matches (seed input)
```

### How the 3D page fits into React

`StadiumViewer` is a plain class that owns the canvas, camera, seat colours and mouse picking
(frame-by-frame 3D work stays outside React's render cycle). `MatchPage` creates it once in an
effect, disposes it on unmount, and renders everything around it as React components: header,
price legend, tooltip, bottom bar, checkout. The viewer reports changes through callbacks
(`onChange`, `onHover`, `onSeatArrived`); React re-renders from the viewer's state.

## Server, database and admin security

Same API as the plain-JS version:

- Seat bookings: one MongoDB document per (match, seat), with a unique index so a seat can never
  be held or sold twice. Holds expire after 10 minutes (TTL index).
- Prices are calculated on the server from `shared/layout.js`; the browser's prices are never trusted.
- Availability is sent as a compact bitmask (bit i = seat i taken), refreshed every 15 s.
- Admin passwords are scrypt-hashed; sessions are signed HttpOnly, SameSite=Strict cookies (8 h);
  failed logins are rate-limited.

Adding venues, sports and matches works as before (see `stadiums/*.json` and `data/*.json`), or
use the admin panel.

## Data status

`national-stadium-karachi.json` uses public facts (names, total capacity, pavilion) with estimated
enclosure positions and seat counts. The other venues, all fixtures and prices are sample data.
