import React, { useEffect, useState } from 'react';
import { generateBalancedPairs } from './domain/balancedPairs.js';
import {
  canEditSessionPairs,
  filterPlayersByName,
  pairMemberIdsInRoster,
  REPLACE_PAIRS_CONFIRMATION_MESSAGE,
} from './gameSessions.js';

const ODD_COUNT_MESSAGE = 'Selecione uma quantidade par de jogadores. Adicione ou remova uma pessoa.';

export default function AutomaticPairBuilder({ session, roster = [], onReplacePairs }) {
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => pairMemberIdsInRoster(session?.pairs, roster));
  const [balanceGender, setBalanceGender] = useState(true);
  const [balanceHeight, setBalanceHeight] = useState(true);
  const [error, setError] = useState(null);
  const [pendingPairs, setPendingPairs] = useState(null);

  const editable = canEditSessionPairs(session);
  const selectedCount = selectedIds.length;
  const evenSelection = selectedCount % 2 === 0;
  const pairPreview = evenSelection ? selectedCount / 2 : 0;

  const visiblePlayers = filterPlayersByName(roster, query).sort((left, right) =>
    String(left.name ?? '').localeCompare(String(right.name ?? ''), 'pt-BR', { sensitivity: 'base' })
  );

  useEffect(() => {
    if (!pendingPairs) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setPendingPairs(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingPairs]);

  const togglePlayer = (player) => {
    if (!editable || !player?.id) return;
    setError(null);
    setSelectedIds((current) =>
      current.includes(player.id) ? current.filter((id) => id !== player.id) : [...current, player.id]
    );
  };

  const applyGeneratedPairs = (pairs, replaceConfirmed) => {
    const result = onReplacePairs?.(pairs, { replaceConfirmed });
    if (result?.errors?.[0]?.code === 'REPLACE_CONFIRMATION_REQUIRED') {
      setPendingPairs(pairs);
      setError(null);
      return result;
    }
    if (!result?.ok) {
      setError(result?.errors?.[0]?.message || 'Não foi possível sortear as duplas.');
      return result;
    }
    setPendingPairs(null);
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

    if (selectedPlayers.length % 2 === 1) {
      setError(ODD_COUNT_MESSAGE);
      return;
    }

    const generated = generateBalancedPairs(selectedPlayers, { balanceGender, balanceHeight });
    if (!generated.ok) {
      setError(generated.errors[0]?.message || 'Não foi possível sortear as duplas.');
      return;
    }

    applyGeneratedPairs(generated.pairs, false);
  };

  const confirmReplace = () => {
    if (!pendingPairs) return;
    applyGeneratedPairs(pendingPairs, true);
  };

  if (!editable) return null;

  return (
    <div
      className="p-4 rounded-xl border space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
    >
      <h3 className="font-bold text-sm">Sortear duplas</h3>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        O balanceamento por nível está sempre ativo.
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

      <p className="text-sm font-semibold">
        {selectedCount} {selectedCount === 1 ? 'selecionado' : 'selecionados'}
        {!evenSelection
          ? ` · ${ODD_COUNT_MESSAGE}`
          : selectedCount < 4
            ? ' · Selecione pelo menos quatro jogadores para sortear duplas.'
            : ` · ${pairPreview} ${pairPreview === 1 ? 'dupla prevista' : 'duplas previstas'}`}
      </p>

      <div className="flex flex-col sm:flex-row gap-2">
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
        className="w-full font-bold py-3 rounded-xl shadow-md cursor-pointer"
        style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
      >
        Sortear duplas
      </button>

      {pendingPairs && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.65)' }}
          onClick={() => setPendingPairs(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="replace-pairs-title"
            className="w-full max-w-md rounded-xl border p-4 space-y-3 shadow-2xl"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-main)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="replace-pairs-title" className="font-bold text-base">
              Substituir duplas
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {REPLACE_PAIRS_CONFIRMATION_MESSAGE}
            </p>
            <button
              type="button"
              onClick={confirmReplace}
              className="w-full font-bold py-3 rounded-xl shadow-md cursor-pointer"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
            >
              Substituir duplas
            </button>
            <button
              type="button"
              onClick={() => setPendingPairs(null)}
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
