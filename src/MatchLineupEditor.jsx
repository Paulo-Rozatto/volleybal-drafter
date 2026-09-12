import React, { useEffect, useState } from 'react';
import {
  classifyLineupMember,
  describeMatchLineupDraft,
  eligiblePlayersForMatchSide,
  filterPlayersByName,
  restoreMatchLineupsFromBaseTeams,
} from './teamGameSessions.js';
import { resolveTeamLabel } from './roundDisplay.js';
import {
  formatLineupMemberLabel,
  formatMatchLineupCount,
  formatTeamIndexLabel,
  matchSideUnitLabel,
} from './teamPresentation.js';

function idsFromLineup(lineup) {
  return (Array.isArray(lineup) ? lineup : [])
    .map((member) => member?.playerId)
    .filter((id) => typeof id === 'string' && id.trim().length > 0);
}

function SideMembers({ lineup, teams, ownTeamId, teamSize }) {
  if (!Array.isArray(lineup) || lineup.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Sem jogadores escalados.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {lineup.map((member) => {
        const classified = classifyLineupMember(member, teams, ownTeamId);
        return (
          <li
            key={member.playerId}
            className="text-xs font-semibold break-words"
            style={{ color: classified.isLoan ? 'var(--accent)' : 'var(--text-main)' }}
          >
            {formatLineupMemberLabel(member, teams, ownTeamId, teamSize)}
          </li>
        );
      })}
    </ul>
  );
}

export default function MatchLineupEditor({
  match,
  teams = [],
  roster = [],
  teamSize = 2,
  canEdit = false,
  onSave,
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState('A');
  const [idsA, setIdsA] = useState([]);
  const [idsB, setIdsB] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(null);

  const size = Number.isInteger(teamSize) ? teamSize : 2;
  const unit = matchSideUnitLabel(size);

  const openEditor = () => {
    setIdsA(idsFromLineup(match?.lineupA));
    setIdsB(idsFromLineup(match?.lineupB));
    setSide('A');
    setQuery('');
    setError(null);
    setOpen(true);
  };

  const closeEditor = () => {
    setOpen(false);
    setError(null);
    setQuery('');
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeEditor();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const draft = describeMatchLineupDraft({
    lineupAPlayerIds: idsA,
    lineupBPlayerIds: idsB,
    match,
    teams,
    format: { teamSize: size, teamCount: teams.length },
    roster,
  });

  const opponentIds = side === 'A' ? idsB : idsA;
  const currentIds = side === 'A' ? idsA : idsB;
  const setCurrentIds = side === 'A' ? setIdsA : setIdsB;
  const candidates = eligiblePlayersForMatchSide(teams, match, side, {
    selectedOpponentIds: opponentIds,
    roster,
  });
  const visibleCandidates = filterPlayersByName(candidates, query).sort((left, right) =>
    String(left.name ?? '').localeCompare(String(right.name ?? ''), 'pt-BR', { sensitivity: 'base' })
  );

  const togglePlayer = (player) => {
    if (!player?.id) return;
    setError(null);
    setCurrentIds((current) => {
      if (current.includes(player.id)) return current.filter((id) => id !== player.id);
      if (current.length >= size) {
        setError(`A escalação não pode ter mais de ${size} jogadores.`);
        return current;
      }
      return [...current, player.id];
    });
  };

  const handleRestore = () => {
    const restored = restoreMatchLineupsFromBaseTeams(teams, match);
    if (!restored.ok) {
      setError(restored.errors[0]?.message || 'Não foi possível restaurar os times-base.');
      return;
    }
    setIdsA(restored.lineupAPlayerIds);
    setIdsB(restored.lineupBPlayerIds);
    setError(null);
  };

  const handleSave = () => {
    const result = onSave?.(idsA, idsB);
    if (result?.ok) {
      closeEditor();
      return;
    }
    setError(result?.errors?.[0]?.message || draft.errors[0]?.message || 'Não foi possível salvar as escalações.');
  };

  const labelA = resolveTeamLabel(teams, match?.teamAId, { teamSize: size });
  const labelB = resolveTeamLabel(teams, match?.teamBId, { teamSize: size });

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <p className="text-xs font-bold">Escalação</p>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {formatMatchLineupCount('A', match?.lineupA?.length ?? 0, size)}
        </p>
        <SideMembers
          lineup={match?.lineupA}
          teams={teams}
          ownTeamId={match?.teamAId}
          teamSize={size}
        />
        <p className="text-xs font-semibold pt-1" style={{ color: 'var(--text-muted)' }}>
          {formatMatchLineupCount('B', match?.lineupB?.length ?? 0, size)}
        </p>
        <SideMembers
          lineup={match?.lineupB}
          teams={teams}
          ownTeamId={match?.teamBId}
          teamSize={size}
        />
      </div>

      {canEdit && (
        <button
          type="button"
          onClick={openEditor}
          className="w-full font-bold py-2 rounded-xl border text-sm cursor-pointer"
          style={{
            backgroundColor: 'var(--bg-subtle)',
            borderColor: 'var(--border-color)',
            color: 'var(--text-main)',
          }}
        >
          Editar escalação
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.65)' }}
          onClick={closeEditor}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`lineup-editor-${match?.id}`}
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border p-4 space-y-3 shadow-2xl"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-main)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id={`lineup-editor-${match?.id}`} className="font-bold text-base">
              Editar escalação
            </h3>

            <div className="flex rounded-lg p-1 gap-1" style={{ backgroundColor: 'var(--bg-subtle)' }}>
              <button
                type="button"
                onClick={() => {
                  setSide('A');
                  setQuery('');
                  setError(null);
                }}
                className="flex-1 py-2 text-sm font-bold rounded-md transition cursor-pointer"
                style={{
                  backgroundColor: side === 'A' ? 'var(--primary)' : 'transparent',
                  color: side === 'A' ? 'var(--text-inverse)' : 'var(--text-muted)',
                }}
              >
                {unit} A
              </button>
              <button
                type="button"
                onClick={() => {
                  setSide('B');
                  setQuery('');
                  setError(null);
                }}
                className="flex-1 py-2 text-sm font-bold rounded-md transition cursor-pointer"
                style={{
                  backgroundColor: side === 'B' ? 'var(--primary)' : 'transparent',
                  color: side === 'B' ? 'var(--text-inverse)' : 'var(--text-muted)',
                }}
              >
                {unit} B
              </button>
            </div>

            <p className="text-sm font-semibold break-words">{side === 'A' ? labelA : labelB}</p>
            <p className="text-sm font-semibold">
              {currentIds.length}/{size}
            </p>

            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar jogador"
              className="w-full border rounded-lg p-2 text-sm outline-none"
              style={{
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-main)',
                borderColor: 'var(--border-color)',
              }}
            />

            {visibleCandidates.length === 0 ? (
              <p className="text-sm text-center py-3" style={{ color: 'var(--text-muted)' }}>
                Nenhum jogador disponível para este lado.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto">
                {visibleCandidates.map((player) => {
                  const selected = currentIds.includes(player.id);
                  const origin = formatTeamIndexLabel(player.teamIndex, size);
                  return (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => togglePlayer(player)}
                      className="w-full text-left px-3 py-3 rounded-xl border font-semibold text-sm cursor-pointer"
                      style={{
                        backgroundColor: selected ? 'var(--primary)' : 'var(--bg-app)',
                        color: selected ? 'var(--text-inverse)' : 'var(--text-main)',
                        borderColor: selected ? 'var(--primary)' : 'var(--border-color)',
                      }}
                    >
                      <span className="block">{player.name}</span>
                      <span
                        className="block text-xs font-semibold"
                        style={{ color: selected ? 'var(--text-inverse)' : 'var(--text-muted)' }}
                      >
                        {player.isOwnTeam ? origin : `Empréstimo · ${origin}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {!draft.ok && (
              <p className="text-xs font-semibold text-red-500">
                {draft.errors[0]?.message}
              </p>
            )}
            {error && <p className="text-xs font-semibold text-red-500">{error}</p>}

            <button
              type="button"
              onClick={handleRestore}
              className="w-full font-bold py-3 rounded-xl border cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-app)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-main)',
              }}
            >
              Restaurar times-base
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="w-full font-bold py-3 rounded-xl shadow-md cursor-pointer"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
            >
              Salvar escalações
            </button>
            <button
              type="button"
              onClick={closeEditor}
              className="w-full font-bold py-3 rounded-xl border cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-main)',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
