import Button from './Button.jsx';

export default function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  children,
}) {
  return (
    <section
      className="rounded-2xl border p-5 space-y-3 text-center"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-color)',
      }}
    >
      <h3 className="text-h3">{title}</h3>
      {description ? (
        <p className="text-small" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      ) : null}
      {children}
      {actionLabel && onAction ? (
        <Button onClick={onAction} className="w-full sm:w-auto">
          {actionLabel}
        </Button>
      ) : null}
    </section>
  );
}
