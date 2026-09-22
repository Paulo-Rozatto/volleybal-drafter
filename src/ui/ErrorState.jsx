import Button from './Button.jsx';

export default function ErrorState({
  message,
  onRetry,
  onBack,
  retryLabel = 'Tentar novamente',
  backLabel,
}) {
  return (
    <section className="space-y-3" role="alert">
      <p className="text-small font-semibold" style={{ color: 'var(--danger)' }}>
        {message || 'Não foi possível carregar.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {onBack && backLabel ? (
          <Button variant="secondary" onClick={onBack}>
            {backLabel}
          </Button>
        ) : null}
        {onRetry ? (
          <Button onClick={onRetry}>{retryLabel}</Button>
        ) : null}
      </div>
    </section>
  );
}
