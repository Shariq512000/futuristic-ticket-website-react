import { useCallback, useEffect, useState } from 'react';

// Runs an async loader when `deps` change. Returns { data, error, loading, reload }.
// When deps change, the previous result is NOT returned while the new one loads
// (otherwise e.g. /stadiums/a → /stadiums/b would briefly show a's data as b's).
// reload() keeps showing the current data while refreshing.
export function useAsync(loader, deps) {
  const key = JSON.stringify(deps);
  const [state, setState] = useState({ data: null, error: null, loading: true, key: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader().then(
      (data) => current && setState({ data, error: null, loading: false, key }),
      (error) => current && setState({ data: null, error, loading: false, key }),
    );
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const stale = state.key !== key;
  return {
    data: stale ? null : state.data,
    error: stale ? null : state.error,
    loading: stale || state.loading,
    reload,
  };
}
