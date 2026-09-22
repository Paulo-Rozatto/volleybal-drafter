import { useCallback, useEffect, useMemo, useState } from 'react';
import EmptyState from '../ui/EmptyState.jsx';
import ErrorState from '../ui/ErrorState.jsx';
import LoadingState from '../ui/LoadingState.jsx';
import { formatWinRatePercent } from '../performancePresentation.js';
import { formatPerformanceModality, listPerformanceModalities } from '../domain/playerPerformance.js';
import { loadGlobalPerformance, splitGlobalLeaderboard } from './globalPerformance.js';
import SocialAvatar from './SocialAvatar.jsx';
import { formatUsername } from './usernames.js';
import PlayerSocialStats from './PlayerSocialStats.jsx';

export function GlobalStatsPanel({
  loading,
  error,
  model,
  selectedPlayerId,
  lineupSize,
  onRetry,
  onSelectPlayer,
  onChangeLineupSize,
}) {
  const board = useMemo(
    () => splitGlobalLeaderboard(model, { lineupSize }),
    [model, lineupSize]
  );
  const modalities = model?.built?.ok ? listPerformanceModalities(model.built.index) : [];
  const selected = (model?.players ?? []).find((player) => player.playerId === selectedPlayerId);

  if (loading) return <LoadingState label="Carregando estatísticas..." />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;

  if (selected && model?.built?.ok) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => onSelectPlayer(null)}
          className="text-sm font-bold cursor-pointer"
          style={{ color: 'var(--primary)' }}
        >
          ← Estatísticas
        </button>
        <PlayerSocialStats
          index={model.built.index}
          playerId={selected.playerId}
          lineupSize={lineupSize}
          onChangeLineupSize={onChangeLineupSize}
          contextLabel="Geral"
          emptyMessage="Ainda não há partidas válidas neste perfil."
        />
      </div>
    );
  }

  if (board.ranked.length === 0) {
    return (
      <EmptyState
        title="Ainda não há ranking global"
        description="Entram jogadores com conta vinculada e partidas válidas."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
        Ranking autenticado do PaDre. Mesmo motor dos grupos. Convidados aparecem no histórico, não
        nesta lista.
      </p>
      {modalities.length > 0 ? (
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
      <ol className="space-y-2">
        {board.ranked.map((row) => (
          <li key={row.playerId}>
            <button
              type="button"
              onClick={() => onSelectPlayer(row.playerId)}
              className="w-full flex items-center gap-3 rounded-xl border p-3 text-left cursor-pointer"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
            >
              <span className="text-caption font-black w-6">{row.position}</span>
              <SocialAvatar
                name={row.displayName || row.playerName}
                seed={row.userId || row.playerId}
                avatarPath={row.avatarPath}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-small font-bold truncate">
                  {row.displayName || row.playerName}
                </span>
                <span className="block text-caption" style={{ color: 'var(--text-muted)' }}>
                  {row.username ? formatUsername(row.username) : ''}
                  {row.username ? ' · ' : ''}
                  {row.matches} jogos · {row.wins}V · {formatWinRatePercent(row.winRate, row.matches)}
                  {' · '}
                  {row.pointDifference > 0 ? '+' : ''}
                  {row.pointDifference}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function GlobalStatsView({ onOpenPlayer }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [model, setModel] = useState(null);
  const [lineupSize, setLineupSize] = useState(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);

  const refresh = useCallback(async () => {
    const result = await loadGlobalPerformance();
    if (result.ok) {
      setModel(result);
      setError(null);
    } else {
      setModel(null);
      setError(result.error?.message || 'Não foi possível carregar as estatísticas.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await loadGlobalPerformance();
      if (cancelled) return;
      if (result.ok) setModel(result);
      else {
        setModel(null);
        setError(result.error?.message || 'Não foi possível carregar as estatísticas.');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <GlobalStatsPanel
      loading={loading}
      error={error}
      model={model}
      selectedPlayerId={selectedPlayerId}
      lineupSize={lineupSize}
      onRetry={refresh}
      onSelectPlayer={(playerId) => {
        setSelectedPlayerId(playerId);
        if (playerId) onOpenPlayer?.(playerId);
      }}
      onChangeLineupSize={setLineupSize}
    />
  );
}
