import { PLAYER_DECISIONS } from './migration/legacyMigration.js';

export default function LegacyPlayerMapping({ players = [], onDecision }) {
  const pending = players.filter((item) => item.status === 'NEEDS_PLAYER_MAPPING');
  if (pending.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Nenhum jogador exige associação explícita. Nomes iguais não são mesclados automaticamente.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Nome não é identidade. Associe só se você tiver certeza de que é o mesmo jogador cloud.
      </p>
      {pending.map((item) => (
        <div
          key={item.legacyId}
          className="p-4 rounded-xl border space-y-2"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
        >
          <p className="text-sm font-semibold">
            Legado: {item.name}
          </p>
          <p className="text-xs break-all" style={{ color: 'var(--text-muted)' }}>
            ID: {item.legacyId}
          </p>
          {(item.collisions ?? []).map((cloud) => (
            <div key={cloud.id} className="space-y-1">
              <p className="text-sm">
                Cloud: {cloud.name}
              </p>
              <p className="text-xs break-all" style={{ color: 'var(--text-muted)' }}>
                ID: {cloud.id}
              </p>
              <button
                type="button"
                className="text-sm font-bold cursor-pointer"
                style={{ color: 'var(--primary)' }}
                onClick={() =>
                  onDecision?.(item.legacyId, {
                    action: PLAYER_DECISIONS.ASSOCIATE,
                    cloudPlayerId: cloud.id,
                  })
                }
              >
                Associar
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-sm font-bold cursor-pointer"
            style={{ color: 'var(--primary)' }}
            onClick={() => onDecision?.(item.legacyId, { action: PLAYER_DECISIONS.CREATE_NEW })}
          >
            Criar novo player cloud
          </button>
        </div>
      ))}
    </div>
  );
}
