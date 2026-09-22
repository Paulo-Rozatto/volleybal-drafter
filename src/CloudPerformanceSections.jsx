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
  partners = null,
  lowestPartners = [],
  hardestOpponents = [],
  bestAgainst = [],
  history = [],
  diagnostics,
  emptyMessage = 'Ainda não há partidas válidas neste perfil.',
  partnerNote,
}) {
  if (!summary || summary.matches === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        {emptyMessage}
      </p>
    );
  }

  const recentHistory = [...history].reverse();
  const partnerList = partners ?? (bestPartner ? [bestPartner] : []);

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
      {partnerNote ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {partnerNote}
        </p>
      ) : null}
      {partnerList.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            Melhores parceiros
          </p>
          <ul className="text-sm space-y-1">
            {partnerList.map((partner) => (
              <li key={partner.partnerId}>
                {partner.partnerName} ({partner.wins}V/{partner.losses}D · {partner.matches} partidas
                juntos)
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {lowestPartners.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            Menor aproveitamento em dupla
          </p>
          <ul className="text-sm space-y-1">
            {lowestPartners.map((partner) => (
              <li key={`low-${partner.partnerId}`}>
                {partner.partnerName} ({partner.wins}V/{partner.losses}D · {partner.matches} partidas
                juntos)
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {hardestOpponents.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            Adversários mais difíceis
          </p>
          <ul className="text-sm space-y-1">
            {hardestOpponents.map((opponent) => (
              <li key={opponent.opponentId}>
                {opponent.opponentName} ({opponent.wins}V/{opponent.losses}D · {opponent.matches}{' '}
                partidas)
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {bestAgainst.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            Melhor desempenho contra
          </p>
          <ul className="text-sm space-y-1">
            {bestAgainst.map((opponent) => (
              <li key={`best-${opponent.opponentId}`}>
                {opponent.opponentName} ({opponent.wins}V/{opponent.losses}D · {opponent.matches}{' '}
                partidas)
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
