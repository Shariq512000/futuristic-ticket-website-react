const common = { viewBox: '0 0 48 48', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4 };

const ICONS = {
  cricket: (
    <svg {...common} strokeLinecap="round" strokeLinejoin="round">
      <path d="M30 6l6 6-17 17-6-6z" />
      <path d="M13 23l-6 6a3 3 0 0 0 0 4l8 8a3 3 0 0 0 4 0l6-6" />
      <circle cx="37" cy="37" r="5" />
    </svg>
  ),
  football: (
    <svg {...common} strokeLinejoin="round">
      <circle cx="24" cy="24" r="18" />
      <path d="M24 15l8 6-3 9h-10l-3-9z" />
      <path d="M24 6v9M32 21l9-3M29 30l5 8M19 30l-5 8M16 21l-9-3" />
    </svg>
  ),
  basketball: (
    <svg {...common}>
      <circle cx="24" cy="24" r="18" />
      <path d="M6 24h36M24 6v36" />
      <path d="M11 11c6 6 6 20 0 26M37 11c-6 6-6 20 0 26" />
    </svg>
  ),
  hockey: (
    <svg {...common} strokeLinecap="round">
      <path d="M30 6L18 34c-2 5-6 7-11 6" />
      <path d="M7 40c4 1 8-1 10-5" />
      <circle cx="34" cy="38" r="4" />
    </svg>
  ),
};

export function SportIcon({ id }) {
  return <div className="sicon">{ICONS[id] || ICONS.football}</div>;
}
