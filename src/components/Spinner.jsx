export function Spinner({ text = 'Loading…' }) {
  return (
    <div className="loading-row">
      <span className="spinner" />
      {text}
    </div>
  );
}
