import {
  formatMatchHistoryDate,
  formatMatchHistoryResult,
  formatMatchHistoryScoreline,
  formatMatchHistorySource,
  formatWinRatePercent,
} from './performancePresentation.js';

const surfaceStyle = {
  backgroundColor: 'var(--bg-surface)',
  borderColor: 'var(--border-color)',
};

export function CloudPerformanceStatCard({ label, value }) {
  return (
    <div className="rounded-xl border p-3" style={surfaceStyle}>
      <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

export function CloudPerformanceSections({
  summary,
  bestPartner,
  hardestOpponents = [],
  history = [],
  diagnostics,
  emptyMessage = 'Ainda não há partidas válidas neste perfil.',
}) {
  if (!summary || summary.matches === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        {emptyMessage}
      </p>
    );
  }

  const recentHistory = [...history].reverse();

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <CloudPerformanceStatCard label="Jogos" value={summary.matches} />
        <CloudPerformanceStatCard label="Vitórias" value={summary.wins} />
        <CloudPerformanceStatCard label="Derrotas" value={summary.losses} />
        <CloudPerformanceStatCard
          label="Aproveitamento"
          value={formatWinRatePercent(summary.winRate, summary.matches)}
        />
        <CloudPerformanceStatCard label="Pontos pró" value={summary.pointsFor} />
        <CloudPerformanceStatCard label="Pontos contra" value={summary.pointsAgainst} />
      </div>
      {bestPartner ? (
        <p className="text-sm">
          Melhor parceiro: {bestPartner.partnerName} ({bestPartner.wins}V/{bestPartner.losses}D)
        </p>
      ) : null}
      {hardestOpponents.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            Adversários mais difíceis
          </p>
          <ul className="text-sm space-y-1">
            {hardestOpponents.map((opponent) => (
              <li key={opponent.opponentId}>
                {opponent.opponentName} ({opponent.wins}V/{opponent.losses}D)
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="space-y-2">
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          Histórico recente
        </p>
        {recentHistory.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Nenhuma partida neste recorte.
          </p>
        ) : (
          <ol className="space-y-2">
            {recentHistory.map((match) => (
              <li
                key={`${match.sourceType}:${match.sourceId}:${match.roundId}:${match.matchId}`}
                className="rounded-lg border p-2 space-y-1"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-app)' }}
              >
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {formatMatchHistoryDate(match.sessionDate)}
                </p>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {formatMatchHistorySource(match)}
                </p>
                <p className="text-sm font-bold">{formatMatchHistoryScoreline(match)}</p>
                <p className="text-xs font-semibold">{formatMatchHistoryResult(match.result)}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
      {diagnostics ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {diagnostics.includedLabel}; {diagnostics.pendingLabel}; {diagnostics.invalidLabel}
        </p>
      ) : null}
    </>
  );
}
