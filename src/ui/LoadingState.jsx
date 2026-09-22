export default function LoadingState({ label = 'Carregando...', rows = 3 }) {
  return (
    <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
      <p className="text-small" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="padre-skeleton h-16 rounded-2xl"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
