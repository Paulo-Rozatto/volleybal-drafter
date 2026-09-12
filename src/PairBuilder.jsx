import React, { useState } from 'react';
import {
  availableRosterPlayers,
  canEditSessionPairs,
  filterPlayersByName,
  pairMembersForEdit,
} from './gameSessions.js';

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

export default function PairBuilder({
  session,
  roster = [],
  showForm = true,
  onRequestEdit,
  onAddPair,
  onUpdatePair,
  onRemovePair,
}) {
  const [query, setQuery] = useState('');
  const [slotA, setSlotA] = useState(null);
  const [slotB, setSlotB] = useState(null);
  const [editingPairId, setEditingPairId] = useState(null);
  const [error, setError] = useState(null);
  const [pendingRemovalId, setPendingRemovalId] = useState(null);
  const [formVisible, setFormVisible] = useState(showForm);

  if (!showForm && formVisible) {
    setFormVisible(false);
    setSlotA(null);
    setSlotB(null);
    setEditingPairId(null);
    setError(null);
    setQuery('');
  } else if (showForm && !formVisible) {
    setFormVisible(true);
  }

  const editable = canEditSessionPairs(session);
  const pairs = session?.pairs ?? [];
  const available = availableRosterPlayers(roster, pairs, editingPairId);
  const visiblePlayers = filterPlayersByName(available, query).sort((left, right) =>
    String(left.name ?? '').localeCompare(String(right.name ?? ''), 'pt-BR', { sensitivity: 'base' })
  );

  const selectedIds = new Set([slotA?.id, slotB?.id].filter(Boolean));

  const resetSelection = () => {
    setSlotA(null);
    setSlotB(null);
    setEditingPairId(null);
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
      setError(result?.errors?.[0]?.message || 'Não foi possível atualizar a dupla.');
      return false;
    }
    if (resetOnSuccess) resetSelection();
    setPendingRemovalId(null);
    return true;
  };

  const handleSubmit = () => {
    const result = editingPairId
      ? onUpdatePair?.(editingPairId, slotA, slotB)
      : onAddPair?.(slotA, slotB);
    applyResult(result);
  };

  const startEdit = (pair) => {
    const [first, second] = pairMembersForEdit(pair, roster);
    setEditingPairId(pair.id);
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
          Este encontro não está em rascunho ou já possui rodadas. As duplas não podem ser alteradas.
        </p>
        {pairs.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Nenhuma dupla formada neste encontro.
          </p>
        ) : (
          pairs.map((pair) => (
            <div
              key={pair.id}
              className="p-3 rounded-xl border"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
            >
              <p className="text-sm font-semibold">
                {(pair.members ?? []).map((member) => member.playerName).join(' + ')}
              </p>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showForm && (
      <div
        className="p-4 rounded-xl border space-y-3"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <h3 className="font-bold text-sm">
          {editingPairId ? 'Alterar dupla' : 'Montar dupla'}
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
              ? 'Não há jogadores disponíveis para novas duplas.'
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
            {editingPairId ? 'Salvar alteração' : 'Adicionar dupla'}
          </button>
          {editingPairId && (
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

      <div className="space-y-2">
        <h3 className="font-bold text-sm">Duplas formadas ({pairs.length})</h3>
        {pairs.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {showForm
              ? 'Nenhuma dupla ainda. Selecione dois jogadores e toque em “Adicionar dupla”.'
              : 'Nenhuma dupla ainda.'}
          </p>
        ) : (
          pairs.map((pair) => (
            <div
              key={pair.id}
              className="p-3 rounded-xl border space-y-2"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
            >
              <p className="text-sm font-semibold">
                {(pair.members ?? []).map((member) => member.playerName).join(' + ')}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(pair)}
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
                    setPendingRemovalId(pair.id);
                    setError(null);
                  }}
                  className="flex-1 font-bold py-2 rounded-xl border text-sm cursor-pointer text-red-500"
                  style={{ backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)' }}
                >
                  Remover
                </button>
              </div>
              {pendingRemovalId === pair.id && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-semibold text-red-500">
                    Remover esta dupla? Os jogadores voltam a ficar disponíveis.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => applyResult(onRemovePair?.(pair.id))}
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
