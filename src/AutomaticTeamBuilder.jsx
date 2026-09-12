import React, { useEffect, useState } from 'react';
import { generateBalancedTeams } from './domain/balancedTeams.js';
import {
  automaticDrawOverCapacityMessage,
  automaticDrawPlayerBounds,
  plannedTeamSizeLabel,
  rosterFitsAutomaticDrawCapacity,
} from './teamFormationUi.js';
import {
  drawTeamsLabel,
  replaceTeamsConfirmationMessage,
  resolveTeamSize,
  teamUnitNoun,
} from './teamPresentation.js';
import {
  canEditSessionTeams,
  filterPlayersByName,
  sessionTeamMemberIdsInRoster,
} from './teamGameSessions.js';

export default function AutomaticTeamBuilder({ session, roster = [], onReplaceTeams }) {
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(() =>
    sessionTeamMemberIdsInRoster(session?.teams, roster)
  );
  const [balanceGender, setBalanceGender] = useState(true);
  const [balanceHeight, setBalanceHeight] = useState(true);
  const [error, setError] = useState(null);
  const [pendingTeams, setPendingTeams] = useState(null);

  const teamSize = resolveTeamSize(session);
  const units = teamUnitNoun(teamSize, 2);
  const editable = canEditSessionTeams(session);
  const teamCount = session?.format?.teamCount ?? 2;
  const format = { teamSize, teamCount };
  const bounds = automaticDrawPlayerBounds(format);
  const selectedCount = selectedIds.length;
  const plannedLabel = plannedTeamSizeLabel(selectedCount, format);
  const rosterExceedsCapacity = Boolean(bounds) && roster.length > bounds.max;
  const canSelectAll =
    rosterFitsAutomaticDrawCapacity(roster.length, format) && roster.length > 0;

  const visiblePlayers = filterPlayersByName(roster, query).sort((left, right) =>
    String(left.name ?? '').localeCompare(String(right.name ?? ''), 'pt-BR', { sensitivity: 'base' })
  );

  useEffect(() => {
    if (!pendingTeams) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setPendingTeams(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingTeams]);

  const togglePlayer = (player) => {
    if (!editable || !player?.id) return;
    setError(null);
    setSelectedIds((current) =>
      current.includes(player.id) ? current.filter((id) => id !== player.id) : [...current, player.id]
    );
  };

  const applyGeneratedTeams = (teams, replaceConfirmed) => {
    const result = onReplaceTeams?.(teams, { replaceConfirmed });
    if (result?.errors?.[0]?.code === 'REPLACE_CONFIRMATION_REQUIRED') {
      setPendingTeams(teams);
      setError(null);
      return result;
    }
    if (!result?.ok) {
      setError(result?.errors?.[0]?.message || `Não foi possível sortear os ${units}.`);
      return result;
    }
    setPendingTeams(null);
    setError(null);
    return result;
  };

  const handleDraw = () => {
    if (!editable) return;

    const selectedPlayers = selectedIds
      .map((id) => roster.find((player) => player?.id === id))
      .filter(Boolean);

    if (selectedPlayers.length !== selectedIds.length) {
      setError('Há jogadores selecionados que não existem mais no elenco.');
      return;
    }

    const generated = generateBalancedTeams(selectedPlayers, format, {
      balanceGender,
      balanceHeight,
    });
    if (!generated.ok) {
      setError(generated.errors[0]?.message || `Não foi possível sortear os ${units}.`);
      return;
    }

    applyGeneratedTeams(generated.teams, false);
  };

  const confirmReplace = () => {
    if (!pendingTeams) return;
    applyGeneratedTeams(pendingTeams, true);
  };

  if (!editable) return null;

  return (
    <div
      className="p-4 rounded-xl border space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
    >
      <h3 className="font-bold text-sm">{drawTeamsLabel(teamSize)}</h3>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        O balanceamento por nível está sempre ativo.
      </p>
      {bounds && (
        <p className="text-sm font-semibold">
          Mínimo: {bounds.min} · Capacidade máxima: {bounds.max}
        </p>
      )}
      <p className="text-sm font-semibold">
        {selectedCount} {selectedCount === 1 ? 'selecionado' : 'selecionados'}
        {plannedLabel ? ` · Distribuição prevista: ${plannedLabel}` : ''}
      </p>
      {rosterExceedsCapacity ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {automaticDrawOverCapacityMessage(bounds.max)}
        </p>
      ) : null}

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

      <div className="flex flex-col sm:flex-row gap-2">
        {canSelectAll ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setSelectedIds(roster.map((player) => player.id).filter(Boolean));
            }}
            className="flex-1 font-bold py-2 rounded-xl border text-sm cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-main)',
            }}
          >
            Selecionar todos
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setError(null);
            setSelectedIds([]);
          }}
          className="flex-1 font-bold py-2 rounded-xl border text-sm cursor-pointer"
          style={{
            backgroundColor: 'var(--bg-app)',
            borderColor: 'var(--border-color)',
            color: 'var(--text-main)',
          }}
        >
          Limpar seleção
        </button>
      </div>

      {visiblePlayers.length === 0 ? (
        <p
          className="text-sm text-center py-4 rounded-xl border border-dashed"
          style={{ color: 'var(--text-muted)', borderColor: 'var(--border-color)' }}
        >
          {roster.length === 0
            ? 'Não há jogadores no elenco para sortear.'
            : 'Nenhum jogador encontrado com essa busca.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto">
          {visiblePlayers.map((player) => {
            const selected = selectedIds.includes(player.id);
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
                {player.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setBalanceGender(!balanceGender)}
          className="py-2 px-2 text-xs font-bold rounded-lg border transition cursor-pointer"
          style={{
            backgroundColor: balanceGender ? 'var(--bg-subtle)' : 'transparent',
            borderColor: balanceGender ? 'var(--primary)' : 'var(--border-color)',
            color: 'var(--text-main)',
          }}
        >
          Balancear gênero {balanceGender ? '✓' : ''}
        </button>
        <button
          type="button"
          onClick={() => setBalanceHeight(!balanceHeight)}
          className="py-2 px-2 text-xs font-bold rounded-lg border transition cursor-pointer"
          style={{
            backgroundColor: balanceHeight ? 'var(--bg-subtle)' : 'transparent',
            borderColor: balanceHeight ? 'var(--primary)' : 'var(--border-color)',
            color: 'var(--text-main)',
          }}
        >
          Balancear altura {balanceHeight ? '✓' : ''}
        </button>
      </div>

      {error && <p className="text-xs font-semibold text-red-500">{error}</p>}

      <button
        type="button"
        onClick={handleDraw}
        className="w-full font-bold py-3 rounded-xl shadow-md cursor-pointer disabled:opacity-50"
        style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
      >
        {drawTeamsLabel(teamSize)}
      </button>

      {pendingTeams && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.65)' }}
          onClick={() => setPendingTeams(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="replace-teams-title"
            className="w-full max-w-md rounded-xl border p-4 space-y-3 shadow-2xl"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-main)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="replace-teams-title" className="font-bold text-base">
              Substituir {units}
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {replaceTeamsConfirmationMessage(teamSize)}
            </p>
            <button
              type="button"
              onClick={confirmReplace}
              className="w-full font-bold py-3 rounded-xl shadow-md cursor-pointer"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
            >
              Substituir {units}
            </button>
            <button
              type="button"
              onClick={() => setPendingTeams(null)}
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
