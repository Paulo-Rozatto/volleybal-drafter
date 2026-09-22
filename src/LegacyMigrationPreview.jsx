export default function LegacyMigrationPreview({ plan, fingerprint, sourceType }) {
  if (!plan) return null;
  const { summary } = plan;
  return (
    <div
      className="p-4 rounded-xl border space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
    >
      <h3 className="font-bold text-sm">Análise (nenhuma escrita)</h3>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Origem: {sourceType === 'gist' ? 'Gist carregado + cache local' : 'localStorage deste navegador'}
      </p>
      {fingerprint ? (
        <p className="text-xs break-all" style={{ color: 'var(--text-muted)' }}>
          Fingerprint: {fingerprint}
        </p>
      ) : null}
      <ul className="text-sm space-y-2">
        <li>
          <strong>Jogadores</strong> {summary.playersFound} encontrados · {summary.playersNew} novos ·{' '}
          {summary.playersNeedMapping} precisam associação · {summary.playersMapped} já mapeados
        </li>
        <li>
          <strong>Encontros</strong> {summary.sessionsFound} encontrados · {summary.sessionsToImport} para importar ·{' '}
          {summary.sessionsImported} já importados · {summary.sessionsConflicts} conflitos
        </li>
        <li>
          <strong>Competições</strong> {summary.competitionsFound} encontradas · {summary.competitionsToImport} para
          importar · {summary.competitionsImported} já importadas
        </li>
        <li>
          <strong>Problemas</strong> {summary.problems}
        </li>
      </ul>
      {plan.schemaError ? (
        <p className="text-sm font-semibold text-red-500">Schema legado não suportado.</p>
      ) : null}
    </div>
  );
}
