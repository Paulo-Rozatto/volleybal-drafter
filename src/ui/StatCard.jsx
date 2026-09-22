export default function StatCard({ label, value }) {
  return (
    <div
      className="rounded-2xl border p-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
    >
      <p className="text-caption font-semibold" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className="mt-1 text-h2 tabular-nums">{value}</p>
    </div>
  );
}
