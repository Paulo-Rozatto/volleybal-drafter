import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatPerformanceModality,
  getBestPartner,
  getHardestOpponents,
  getPlayerMatchHistory,
  getPlayerPerformance,
  listPerformanceModalities,
} from './domain/playerPerformance.js';
import { CloudPerformanceSections } from './CloudPerformanceSections.jsx';
import { formatHistoryDiagnostics, formatWinRatePercent } from './performancePresentation.js';
import { shouldApplyGroupLoad } from './cloudGroupPanel.js';
import {
  buildGroupPerformanceIndex,
  splitGroupLeaderboard,
} from './supabase/groupPerformance.js';
import { getGroupPerformanceMatches } from './supabase/groupPerformanceApi.js';

function memberLabel(member) {
  return member.playerName || member.displayName || member.userId;
}

export function CloudGroupRankingPanel({
  loading,
  error,
  payload,
  selectedUserId,
  lineupSize,
  onRetry,
  onSelectUser,
  onChangeLineupSize,
}) {
  const model = useMemo(
    () => (payload ? buildGroupPerformanceIndex(payload) : null),
    [payload]
  );
  const board = useMemo(
    () =>
      model
        ? splitGroupLeaderboard(model.built, model.members, { lineupSize })
        : { ranked: [], withoutMatches: [], unlinked: [] },
    [model, lineupSize]
  );
  const modalities = model?.built?.ok ? listPerformanceModalities(model.built.index) : [];
  const selectedMember = (model?.members ?? []).find((member) => member.userId === selectedUserId) ?? null;

  if (loading) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Carregando ranking...
      </p>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-red-500">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="text-sm font-bold cursor-pointer"
          style={{ color: 'var(--primary)' }}
        >
          Recarregar
        </button>
      </div>
    );
  }

  if (selectedMember) {
    return (
      <GroupMemberProfile
        member={selectedMember}
        model={model}
        lineupSize={lineupSize}
        modalities={modalities}
        onBack={() => onSelectUser(null)}
        onChangeLineupSize={onChangeLineupSize}
      />
    );
  }

  const emptyGroup =
    board.ranked.length === 0 && board.withoutMatches.length === 0 && board.unlinked.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-sm">Ranking do grupo</h3>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-bold cursor-pointer"
          style={{ color: 'var(--primary)' }}
        >
          Atualizar
        </button>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Só entram partidas de encontros deste grupo. Convidados aparecem no histórico, não no
        ranking. Ordenação: vitórias, depois os desempates do motor (jogos, aproveitamento, saldo,
        pontos, nome, id).
      </p>
      {modalities.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChangeLineupSize(null)}
            className="text-xs font-bold px-2 py-1 rounded-lg cursor-pointer"
            style={{
              backgroundColor: lineupSize == null ? 'var(--primary)' : 'var(--bg-subtle)',
              color: lineupSize == null ? 'var(--text-inverse)' : 'var(--text-main)',
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
                color: lineupSize === size ? 'var(--text-inverse)' : 'var(--text-main)',
              }}
            >
              {formatPerformanceModality(size)}
            </button>
          ))}
        </div>
      ) : null}

      {emptyGroup ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Este grupo ainda não tem membros no ranking.
        </p>
      ) : null}

      {board.ranked.length === 0 && !emptyGroup ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Ainda não há partidas válidas no grupo.
        </p>
      ) : (
        <ol className="space-y-2">
          {board.ranked.map((row) => {
            const member = model.members.find((item) => item.playerId === row.playerId);
            return (
              <li key={row.playerId}>
                <button
                  type="button"
                  onClick={() => onSelectUser(member?.userId ?? null)}
                  className="w-full text-left p-3 rounded-xl border cursor-pointer"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
                >
                  <p className="font-semibold">
                    #{row.position} {row.playerName}
                  </p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {row.matches} jogos · {row.wins}V/{row.losses}D ·{' '}
                    {formatWinRatePercent(row.winRate, row.matches)}
                  </p>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {board.withoutMatches.length > 0 ? (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            Ainda sem partidas no grupo
          </h4>
          {board.withoutMatches.map((member) => (
            <button
              key={member.userId}
              type="button"
              onClick={() => onSelectUser(member.userId)}
              className="w-full text-left p-3 rounded-xl border cursor-pointer"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
            >
              <p className="text-sm">{memberLabel(member)}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Sem partidas
              </p>
            </button>
          ))}
        </section>
      ) : null}

      {board.unlinked.length > 0 ? (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            Jogador ainda não vinculado
          </h4>
          {board.unlinked.map((member) => (
            <div
              key={member.userId}
              className="p-3 rounded-xl border"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
            >
              <p className="text-sm">{member.displayName || member.userId}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Jogador ainda não vinculado
              </p>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function GroupMemberProfile({ member, model, lineupSize, modalities, onBack, onChangeLineupSize }) {
  if (!member.playerId) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={onBack} className="text-sm font-bold cursor-pointer" style={{ color: 'var(--primary)' }}>
          ← Ranking
        </button>
        <h3 className="font-bold">{member.displayName || member.userId}</h3>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Jogador ainda não vinculado
        </p>
      </div>
    );
  }

  const built = model?.built;
  const filters = { lineupSize };
  const summary =
    built?.ok ? getPlayerPerformance(built.index, member.playerId, filters) : null;
  const bestPartner = built?.ok ? getBestPartner(built.index, member.playerId, filters) : null;
  const hardestOpponents = built?.ok
    ? getHardestOpponents(built.index, member.playerId, filters).slice(0, 3)
    : [];
  const history = built?.ok ? getPlayerMatchHistory(built.index, member.playerId, filters) : [];
  const diagnostics = built?.ok ? formatHistoryDiagnostics(built.index) : null;
  const ranked = built?.ok
    ? splitGroupLeaderboard(built, model.members, { lineupSize }).ranked
    : [];
  const position = ranked.find((row) => row.playerId === member.playerId)?.position ?? null;

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-sm font-bold cursor-pointer" style={{ color: 'var(--primary)' }}>
        ← Ranking
      </button>
      <h3 className="font-bold">{memberLabel(member)}</h3>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        {position ? `Ranking: #${position}` : 'Sem posição neste recorte'} · somente partidas deste
        grupo
      </p>
      {modalities.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChangeLineupSize(null)}
            className="text-xs font-bold px-2 py-1 rounded-lg cursor-pointer"
            style={{
              backgroundColor: lineupSize == null ? 'var(--primary)' : 'var(--bg-subtle)',
              color: lineupSize == null ? 'var(--text-inverse)' : 'var(--text-main)',
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
                color: lineupSize === size ? 'var(--text-inverse)' : 'var(--text-main)',
              }}
            >
              {formatPerformanceModality(size)}
            </button>
          ))}
        </div>
      ) : null}
      {!built?.ok ? (
        <p className="text-sm font-semibold text-red-500">Não foi possível calcular o desempenho.</p>
      ) : (
        <CloudPerformanceSections
          summary={summary}
          bestPartner={bestPartner}
          hardestOpponents={hardestOpponents}
          history={history}
          diagnostics={diagnostics}
          emptyMessage="Ainda sem partidas no grupo"
        />
      )}
    </div>
  );
}

export default function CloudGroupRanking({ groupId, selectedUserId, onSelectUser }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [payload, setPayload] = useState(null);
  const [lineupSize, setLineupSize] = useState(null);
  const groupIdRef = useRef(groupId);

  useEffect(() => {
    groupIdRef.current = groupId;
  }, [groupId]);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getGroupPerformanceMatches(groupId);
      if (!shouldApplyGroupLoad(groupId, groupIdRef.current)) return;
      if (result.ok) {
        setPayload(result.payload);
        setError(null);
      } else {
        setPayload(null);
        setError(result.error?.message || 'Não foi possível carregar o ranking.');
      }
    } catch (caught) {
      if (!shouldApplyGroupLoad(groupId, groupIdRef.current)) return;
      setPayload(null);
      setError(caught?.message || 'Não foi possível carregar o ranking.');
    } finally {
      if (shouldApplyGroupLoad(groupId, groupIdRef.current)) setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    setPayload(null);
    setError(null);
    setLineupSize(null);
    refresh();
  }, [refresh]);

  return (
    <CloudGroupRankingPanel
      loading={loading}
      error={error}
      payload={payload}
      selectedUserId={selectedUserId}
      lineupSize={lineupSize}
      onRetry={refresh}
      onSelectUser={onSelectUser}
      onChangeLineupSize={setLineupSize}
    />
  );
}
