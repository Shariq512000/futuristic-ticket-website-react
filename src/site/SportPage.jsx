import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { plural } from '../lib/format.js';
import { SportIcon } from '../components/SportIcon.jsx';
import { Spinner } from '../components/Spinner.jsx';
import MatchCard, { LoadError } from './MatchCard.jsx';

export default function SportPage() {
  const { id } = useParams();
  const [venue, setVenue] = useState('all');
  const { data, error, loading, reload } = useAsync(
    () => Promise.all([api.sport(id), api.matches({ sport: id })]),
    [id],
  );
  const venues = useMemo(
    () => (data ? [...new Map(data[1].map((m) => [m.venue.id, m.venue])).values()] : []),
    [data],
  );

  if (loading && !data) return <Spinner />;
  if (error?.status === 404) {
    return <section className="hero"><h1>Sport not found</h1><p><Link to="/">Back to all sports</Link></p></section>;
  }
  if (error) return <LoadError error={error} onRetry={reload} />;

  const [sport, all] = data;
  const list = venue === 'all' ? all : all.filter((m) => m.venue.id === venue);

  return (
    <>
      <section className="sport-head">
        <Link className="back" to="/">← All sports</Link>
        <div className="sport-title">
          <SportIcon id={sport.id} />
          <div>
            <h1>{sport.name}</h1>
            <p>{all.length ? plural(all.length, 'upcoming match') : 'No upcoming matches'}</p>
          </div>
        </div>
        {venues.length > 1 && (
          <div className="chips">
            <button type="button" className={`chip${venue === 'all' ? ' on' : ''}`} onClick={() => setVenue('all')}>All venues</button>
            {venues.map((v) => (
              <button type="button" key={v.id} className={`chip${venue === v.id ? ' on' : ''}`} onClick={() => setVenue(v.id)}>{v.name}</button>
            ))}
          </div>
        )}
      </section>
      <section>
        <div className="mlist">
          {list.length ? list.map((m) => <MatchCard key={m.id} match={m} />) : (
            <div className="empty-box">
              <b>No upcoming {sport.name.toLowerCase()} matches</b>
              <span>New fixtures will appear here once they are announced.</span>
              <Link to="/">Browse other sports</Link>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
