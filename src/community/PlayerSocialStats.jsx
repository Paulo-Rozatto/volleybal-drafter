import { formatPerformanceModality } from '../domain/playerPerformance.js';
import { CloudPerformanceSections } from '../CloudPerformanceSections.jsx';
import { BEST_PARTNER_RANKING_NOTE } from '../performancePresentation.js';
import { buildPlayerSocialStats } from './playerSocialStats.js';

export default function PlayerSocialStats({
  index,
  playerId,
  lineupSize = null,
  onChangeLineupSize,
  contextLabel,
  emptyMessage,
}) {
  const stats = buildPlayerSocialStats(index, playerId, { lineupSize });
  const modalities = stats.modalities;

  return (
    <div className="space-y-3">
      {contextLabel ? (
        <p className="text-caption font-semibold" style={{ color: 'var(--text-muted)' }}>
          {contextLabel}
        </p>
      ) : null}
      {modalities.length > 0 && onChangeLineupSize ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChangeLineupSize(null)}
            className="text-xs font-bold px-2 py-1 rounded-lg cursor-pointer"
            style={{
              backgroundColor: lineupSize == null ? 'var(--primary)' : 'var(--bg-subtle)',
              color: lineupSize == null ? 'var(--text-on-primary)' : 'var(--text-main)',
            }}
          >
            Todas
          </button>
          {modalities.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => onChangeLineupSize(size)}
              className="text-xs font-bold px-2 py-1 rounded-lg cursor-pointer"
              style={{
                backgroundColor: lineupSize === size ? 'var(--primary)' : 'var(--bg-subtle)',
                color: lineupSize === size ? 'var(--text-on-primary)' : 'var(--text-main)',
              }}
            >
              {formatPerformanceModality(size)}
            </button>
          ))}
        </div>
      ) : null}
      <CloudPerformanceSections
        summary={stats.summary}
        bestPartner={stats.partners[0] ?? null}
        partners={stats.partners}
        lowestPartners={stats.lowestPartners}
        hardestOpponents={stats.hardestOpponents}
        bestAgainst={stats.bestAgainst}
        history={stats.history}
        diagnostics={stats.diagnostics}
        emptyMessage={emptyMessage}
        partnerNote={BEST_PARTNER_RANKING_NOTE}
      />
    </div>
  );
}
