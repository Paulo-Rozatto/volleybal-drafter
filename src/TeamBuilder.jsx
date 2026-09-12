import React, { useState } from 'react';
import {
  availablePlayersForTeams,
  canEditSessionTeams,
  filterPlayersByName,
  teamMembersForEdit,
  usesDoublesLabels,
} from './teamGameSessions.js';

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

export default function TeamBuilder({
  session,
  roster = [],
  showForm = true,
  onRequestEdit,
  onAddTeam,
  onUpdateTeam,
  onRemoveTeam,
}) {
  const [query, setQuery] = useState('');
  const [slotA, setSlotA] = useState(null);
  const [slotB, setSlotB] = useState(null);
  const [editingTeamId, setEditingTeamId] = useState(null);
  const [error, setError] = useState(null);
  const [pendingRemovalId, setPendingRemovalId] = useState(null);
  const [formVisible, setFormVisible] = useState(showForm);

  if (!showForm && formVisible) {
    setFormVisible(false);
    setSlotA(null);
    setSlotB(null);
    setEditingTeamId(null);
    setError(null);
    setQuery('');
  } else if (showForm && !formVisible) {
    setFormVisible(true);
  }

  const doubles = usesDoublesLabels(session);
  const unit = doubles ? 'dupla' : 'time';
  const units = doubles ? 'duplas' : 'times';
  const editable = canEditSessionTeams(session);
  const teams = session?.teams ?? [];
  const teamCount = session?.format?.teamCount ?? 2;
  const canAddMore = teams.length < teamCount;
  const available = availablePlayersForTeams(roster, teams, editingTeamId);
  const visiblePlayers = filterPlayersByName(available, query).sort((left, right) =>
    String(left.name ?? '').localeCompare(String(right.name ?? ''), 'pt-BR', { sensitivity: 'base' })
  );
  const showEditor = showForm && (canAddMore || Boolean(editingTeamId));

  const selectedIds = new Set([slotA?.id, slotB?.id].filter(Boolean));

  const resetSelection = () => {
    setSlotA(null);
    setSlotB(null);
    setEditingTeamId(null);
    setError(null);
    setQuery('');
  };

  const togglePlayer = (player) => {
    setError(null);
    if (slotA?.id === player.id) {
      setSlotA(null);
      return;
    }
    if (slotB?.id === player.id) {
      setSlotB(null);
      return;
    }
    if (!slotA) {
      setSlotA(player);
      return;
    }
    if (!slotB) {
      setSlotB(player);
    }
  };

  const applyResult = (result, { resetOnSuccess } = { resetOnSuccess: true }) => {
    if (!result?.ok) {
      setError(result?.errors?.[0]?.message || `Não foi possível atualizar a ${unit}.`);
      return false;
    }
    if (resetOnSuccess) resetSelection();
    setPendingRemovalId(null);
    return true;
  };

  const handleSubmit = () => {
    if (!slotA || !slotB) {
      setError(`Selecione dois jogadores para formar a ${unit}.`);
      return;
    }
    const result = editingTeamId
      ? onUpdateTeam?.(editingTeamId, slotA, slotB)
      : onAddTeam?.(slotA, slotB);
    applyResult(result);
  };

  const startEdit = (team) => {
    const [first, second] = teamMembersForEdit(team, roster);
    setEditingTeamId(team.id);
    setSlotA(first ?? null);
    setSlotB(second ?? null);
    setError(null);
    setPendingRemovalId(null);
    onRequestEdit?.();
  };

  if (!editable) {
    return (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Este encontro não está em rascunho ou já possui rodadas. As {units} não podem ser alteradas.
        </p>
        {teams.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Nenhuma {unit} formada neste encontro.
          </p>
        ) : (
          teams.map((team) => (
            <div
              key={team.id}
              className="p-3 rounded-xl border"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
            >
              <p className="text-sm font-semibold">
                {(team.members ?? []).map((member) => member.playerName).join(' + ')}
              </p>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showEditor && (
      <div
        className="p-4 rounded-xl border space-y-3"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <h3 className="font-bold text-sm">
          {editingTeamId ? `Alterar ${unit}` : `Montar ${unit}`}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <PlayerSlot label="Jogador 1" player={slotA} onClear={() => setSlotA(null)} />
          <PlayerSlot label="Jogador 2" player={slotB} onClear={() => setSlotB(null)} />
        </div>

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
              ? `Não há jogadores disponíveis para novas ${units}.`
              : 'Nenhum jogador encontrado com essa busca.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto">
            {visiblePlayers.map((player) => {
              const selected = selectedIds.has(player.id);
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

        {error && <p className="text-xs font-semibold text-red-500">{error}</p>}

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            className="flex-1 font-bold py-3 rounded-xl shadow-md cursor-pointer"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
          >
            {editingTeamId ? 'Salvar alteração' : `Adicionar ${unit}`}
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
      </div>
      )}

      {!canAddMore && showForm && !editingTeamId && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Todas as {units} já foram formadas ({teams.length}/{teamCount}).
        </p>
      )}

      <div className="space-y-2">
        <h3 className="font-bold text-sm">
          {doubles
            ? `Duplas formadas (${teams.length}/${teamCount})`
            : `Times formados (${teams.length}/${teamCount})`}
        </h3>
        {teams.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {showForm
              ? `Nenhuma ${unit} ainda. Selecione dois jogadores e toque em “Adicionar ${unit}”.`
              : `Nenhuma ${unit} ainda.`}
          </p>
        ) : (
          teams.map((team) => (
            <div
              key={team.id}
              className="p-3 rounded-xl border space-y-2"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
            >
              <p className="text-sm font-semibold">
                {(team.members ?? []).map((member) => member.playerName).join(' + ')}
              </p>
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
