import React, { useState } from 'react';
import {
  canSelectAnotherMember,
  canSubmitManualTeam,
  manualTeamSubmitError,
  needsEmptyTeamConfirmation,
  requiresExactPair,
  toggleSelectedPlayer,
} from './teamFormationUi.js';
import {
  EMPTY_TEAM_CONFIRM_LABEL,
  EMPTY_TEAM_CONFIRMATION_MESSAGE,
  addTeamActionLabel,
  formatSessionTeamLabel,
  noAvailablePlayersMessage,
  selectedCountLabel,
  teamUnitSingular,
} from './teamPresentation.js';
import {
  availablePlayersForCompetition,
  competitionSeedHint,
  competitionTeamSize,
  competitionTeamsHeading,
  competitionTeamsLockedMessage,
} from './competitionPresentation.js';
import { filterPlayersByName, teamMembersForEdit } from './teamGameSessions.js';
import { INVALID_COMPETITIONS_CACHE_CONFIRMATION_REQUIRED } from './persistence/competitionOperations.js';

function PlayerSlot({ label, player, onClear }) {
  return (
    <div
      className="rounded-xl border p-3 min-h-[4.5rem]"
      style={{ backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)' }}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      {player ? (
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold truncate">{player.name}</p>
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-bold px-2 py-1 rounded-lg cursor-pointer"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
          >
            Limpar
          </button>
        </div>
      ) : (
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Toque em um jogador
        </p>
      )}
    </div>
  );
}

export default function CompetitionTeamBuilder({
  competition,
  roster = [],
  onAddTeam,
  onUpdateTeam,
  onRemoveTeam,
  onMoveTeam,
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [editingTeamId, setEditingTeamId] = useState(null);
  const [error, setError] = useState(null);
  const [pendingRemovalId, setPendingRemovalId] = useState(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const teamSize = competitionTeamSize(competition);
  const doubles = requiresExactPair(teamSize);
  const unit = teamUnitSingular(teamSize);
  const editable = competition?.status === 'draft' && (competition?.rounds ?? []).length === 0;
  const teams = competition?.teams ?? [];
  const available = availablePlayersForCompetition(roster, teams, editingTeamId);
  const visiblePlayers = filterPlayersByName(available, query).sort((left, right) =>
    String(left.name ?? '').localeCompare(String(right.name ?? ''), 'pt-BR', { sensitivity: 'base' })
  );
  const selectedIds = new Set(selected.map((player) => player?.id).filter(Boolean));

  const resetSelection = () => {
    setSelected([]);
    setEditingTeamId(null);
    setError(null);
    setQuery('');
    setConfirmEmpty(false);
  };

  const applyResult = (result, { resetOnSuccess } = { resetOnSuccess: true }) => {
    if (result?.errors?.[0]?.code === INVALID_COMPETITIONS_CACHE_CONFIRMATION_REQUIRED) {
      return false;
    }
    if (!result?.ok) {
      setError(result?.errors?.[0]?.message || `Não foi possível atualizar ${doubles ? 'a dupla' : 'o time'}.`);
      return false;
    }
    if (resetOnSuccess) resetSelection();
    setPendingRemovalId(null);
    setConfirmEmpty(false);
    return true;
  };

  const submitMembers = (memberIds) => {
    const result = editingTeamId
      ? onUpdateTeam?.(editingTeamId, memberIds)
      : onAddTeam?.(memberIds);
    applyResult(result);
  };

  const handleSubmit = ({ emptyConfirmed = false } = {}) => {
    const selectedCount = selected.length;
    const submitError = manualTeamSubmitError(teamSize, selectedCount);
    if (submitError) {
      setError(submitError);
      return;
    }
    if (!canSubmitManualTeam(teamSize, selectedCount)) {
      setError(`Não foi possível atualizar ${doubles ? 'a dupla' : 'o time'}.`);
      return;
    }
    if (!editingTeamId && needsEmptyTeamConfirmation(teamSize, selectedCount) && !emptyConfirmed) {
      setConfirmEmpty(true);
      return;
    }
    submitMembers(selected.map((player) => player.id));
  };

  const startEdit = (team) => {
    setEditingTeamId(team.id);
    setSelected(teamMembersForEdit(team, roster));
    setError(null);
    setPendingRemovalId(null);
    setConfirmEmpty(false);
  };

  const teamCardLabel = (team, index) => formatSessionTeamLabel(team, { teamSize, index });

  if (!editable) {
    return (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {competitionTeamsLockedMessage(teamSize)}
        </p>
        {teams.map((team, index) => (
          <div
            key={team.id}
            className="p-3 rounded-xl border"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
          >
            <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
              Seed {index + 1}
            </p>
            <p className="text-sm font-semibold break-words">{teamCardLabel(team, index)}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className="p-4 rounded-xl border space-y-3"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <h3 className="font-bold text-sm">
          {editingTeamId ? `Alterar ${unit}` : `Montar ${unit}`}
        </h3>

        {doubles ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <PlayerSlot
              label="Jogador 1"
              player={selected[0] ?? null}
              onClear={() => setSelected((current) => current.filter((_, index) => index !== 0))}
            />
            <PlayerSlot
              label="Jogador 2"
              player={selected[1] ?? null}
              onClear={() => setSelected((current) => current.filter((_, index) => index !== 1))}
            />
          </div>
        ) : (
          <>
            <p className="text-sm font-semibold">{selectedCountLabel(selected.length, teamSize)}</p>
            <div
              className="rounded-xl border p-3 space-y-2"
              style={{ backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)' }}
            >
              {selected.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Nenhum jogador selecionado
                </p>
              ) : (
                selected.map((player) => (
                  <div key={player.id} className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate">{player.name}</p>
                    <button
                      type="button"
                      onClick={() => setSelected((current) => toggleSelectedPlayer(current, player, teamSize))}
                      className="text-xs font-bold px-2 py-1 rounded-lg cursor-pointer"
                      style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                    >
                      Limpar
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}

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

        {visiblePlayers.length === 0 ? (
          <p
            className="text-sm text-center py-4 rounded-xl border border-dashed"
            style={{ color: 'var(--text-muted)', borderColor: 'var(--border-color)' }}
          >
            {available.length === 0
              ? noAvailablePlayersMessage(teamSize)
              : 'Nenhum jogador encontrado com essa busca.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto">
            {visiblePlayers.map((player) => {
              const isSelected = selectedIds.has(player.id);
              const disabled = !isSelected && !canSelectAnotherMember(teamSize, selected.length);
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => {
                    setError(null);
                    setConfirmEmpty(false);
                    setSelected((current) => toggleSelectedPlayer(current, player, teamSize));
                  }}
                  disabled={disabled}
                  className="w-full text-left px-3 py-3 rounded-xl border font-semibold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: isSelected ? 'var(--primary)' : 'var(--bg-app)',
                    color: isSelected ? 'var(--text-inverse)' : 'var(--text-main)',
                    borderColor: isSelected ? 'var(--primary)' : 'var(--border-color)',
                  }}
                >
                  {player.name}
                </button>
              );
            })}
          </div>
        )}

        {error && <p className="text-xs font-semibold text-red-500">{error}</p>}

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => handleSubmit()}
            className="flex-1 font-bold py-3 rounded-xl shadow-md cursor-pointer"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
          >
            {addTeamActionLabel(teamSize, Boolean(editingTeamId))}
          </button>
          {editingTeamId && (
            <button
              type="button"
              onClick={resetSelection}
              className="flex-1 font-bold py-3 rounded-xl border cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-main)',
              }}
            >
              Cancelar
            </button>
          )}
        </div>

        {confirmEmpty && (
          <div className="space-y-2 pt-1">
            <p className="text-xs font-semibold text-red-500">{EMPTY_TEAM_CONFIRMATION_MESSAGE}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleSubmit({ emptyConfirmed: true })}
                className="flex-1 font-bold py-2 rounded-xl text-sm cursor-pointer"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
              >
                {EMPTY_TEAM_CONFIRM_LABEL}
              </button>
              <button
                type="button"
                onClick={() => setConfirmEmpty(false)}
                className="flex-1 font-bold py-2 rounded-xl border text-sm cursor-pointer"
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

      <div className="space-y-2">
        <h3 className="font-bold text-sm">{competitionTeamsHeading(teams.length, teamSize)}</h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {competitionSeedHint(teamSize)}
        </p>
        {teams.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {doubles
              ? 'Nenhuma dupla ainda. Selecione dois jogadores e adicione a dupla.'
              : 'Nenhum time ainda. Selecione os jogadores e adicione o time.'}
          </p>
        ) : (
          teams.map((team, index) => (
            <div
              key={team.id}
              className="p-3 rounded-xl border space-y-2"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
                    Seed {index + 1}
                  </p>
                  <p className="text-sm font-semibold break-words">{teamCardLabel(team, index)}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label={`Subir seed ${index + 1}`}
                    disabled={index === 0}
                    onClick={() => applyResult(onMoveTeam?.(team.id, -1), { resetOnSuccess: false })}
                    className="px-2 py-1 rounded-lg border text-sm font-bold cursor-pointer disabled:opacity-40"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Descer seed ${index + 1}`}
                    disabled={index === teams.length - 1}
                    onClick={() => applyResult(onMoveTeam?.(team.id, 1), { resetOnSuccess: false })}
                    className="px-2 py-1 rounded-lg border text-sm font-bold cursor-pointer disabled:opacity-40"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
                  >
                    ↓
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(team)}
                  className="flex-1 font-bold py-2 rounded-xl border text-sm cursor-pointer"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-main)',
                  }}
                >
                  Alterar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingRemovalId(team.id);
                    setError(null);
                  }}
                  className="flex-1 font-bold py-2 rounded-xl border text-sm cursor-pointer text-red-500"
                  style={{ backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)' }}
                >
                  Remover
                </button>
              </div>
              {pendingRemovalId === team.id && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-semibold text-red-500">
                    Remover esta {unit}? Os jogadores voltam a ficar disponíveis.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => applyResult(onRemoveTeam?.(team.id))}
                      className="flex-1 font-bold py-2 rounded-xl text-sm cursor-pointer"
                      style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
                    >
                      Confirmar remoção
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingRemovalId(null)}
                      className="flex-1 font-bold py-2 rounded-xl border text-sm cursor-pointer"
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
          ))
        )}
      </div>
    </div>
  );
}
