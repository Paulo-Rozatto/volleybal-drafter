function mark(ok) {
  return ok ? '✓' : '✗';
}

export default function LegacyMigrationReport({ results = [], onRetryFailed }) {
  const failed = results.filter((item) => item.ok === false);
  return (
    <div className="space-y-3">
      <ul className="text-sm space-y-1">
        {results.map((item) => (
          <li key={`${item.entityType}:${item.legacyId}`}>
            {mark(item.ok !== false)} {item.name || item.legacyId}
            {item.ok === false ? ` — ${item.errorCode || item.error?.code || 'IMPORT_FAILED'}` : ''}
            {item.status === 'already_imported' || item.status === 'ALREADY_IMPORTED' ? ' (já importado)' : ''}
          </li>
        ))}
      </ul>
      {failed.length > 0 ? (
        <button
          type="button"
          className="text-sm font-bold cursor-pointer"
          style={{ color: 'var(--primary)' }}
          onClick={onRetryFailed}
        >
          Tentar falhas novamente
        </button>
      ) : null}
    </div>
  );
}
