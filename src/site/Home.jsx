import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { plural } from '../lib/format.js';
import { SportIcon } from '../components/SportIcon.jsx';
import { Spinner } from '../components/Spinner.jsx';
import MatchCard, { LoadError } from './MatchCard.jsx';

export default function Home() {
  const { data, error, loading, reload } = useAsync(
    () => Promise.all([api.sports(), api.matches({ limit: 4 })]),
    [],
  );
  if (loading && !data) return <Spinner />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const [sports, next] = data;

  return (
    <>
      <section className="hero">
        <h1>Pick your sport.<br /><span>Pick your exact seat.</span></h1>
        <p>Browse upcoming matches, explore every stadium in 3D and see the view from your seat before you buy.</p>
      </section>

      <section>
        <h2 className="sec-title">Sports</h2>
        <div className="sports">
          {sports.map((s) => (
            <Link key={s.id} className={`sport${s.upcoming ? '' : ' empty'}`} to={`/sport/${encodeURIComponent(s.id)}`}>
              <SportIcon id={s.id} />
              <b>{s.name}</b>
              <span>{s.tagline}</span>
              <em>{s.upcoming ? `${plural(s.upcoming, 'upcoming match')}` : 'No matches yet'}</em>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="sec-title">Coming up next</h2>
        <div className="mlist">
          {next.length ? next.map((m) => <MatchCard key={m.id} match={m} />) : <p className="empty-note">No upcoming matches.</p>}
        </div>
      </section>
    </>
  );
}
