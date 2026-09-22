import { formatMigrationProgress } from './legacyMigrationPanel.js';

export default function LegacyMigrationProgress({
  phase,
  sessionDone = 0,
  sessionTotal = 0,
  competitionDone = 0,
  competitionTotal = 0,
  playerDone = 0,
  playerTotal = 0,
  cancelled = false,
}) {
  return (
    <div
      className="p-4 rounded-xl border space-y-2"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
    >
      <h3 className="font-bold text-sm">{cancelled ? 'Migração interrompida' : 'Migrando'}</h3>
      <p className="text-sm">Jogadores {formatMigrationProgress(playerDone, playerTotal)}</p>
      <p className="text-sm">Encontros {formatMigrationProgress(sessionDone, sessionTotal)}</p>
      <p className="text-sm">Competições {formatMigrationProgress(competitionDone, competitionTotal)}</p>
      {phase ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {phase}
        </p>
      ) : null}
    </div>
  );
}
