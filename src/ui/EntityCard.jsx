import StatusBadge from './StatusBadge.jsx';

export default function EntityCard({ title, dateLabel, status, meta, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left p-4 rounded-2xl border cursor-pointer min-h-11 space-y-1"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-bold leading-snug">{title}</p>
        {status ? <StatusBadge status={status} /> : null}
      </div>
      <p className="text-small" style={{ color: 'var(--text-muted)' }}>
        {[dateLabel, meta].filter(Boolean).join(' · ')}
      </p>
    </button>
  );
}
