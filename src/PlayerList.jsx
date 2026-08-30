import React from 'react';

export default function PlayerList({ players = [], onUpdatePlayer, onDeletePlayer }) {
  // Sort players alphabetically by name (case and accent insensitive)
  const sortedPlayers = [...players].sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
  );

  if (!players || players.length === 0) {
    return (
      <div
        className="text-center py-8 rounded-xl border border-dashed text-sm"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-muted)'
        }}
      >
        Nenhum jogador encontrado.
      </div>
    );
  }

  return (
    <div
      className="w-full overflow-hidden rounded-xl border shadow-sm transition-colors"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-color)'
      }}
    >
      {/* Header */}
      <div
        className="flex text-xs font-bold uppercase tracking-wider p-3 items-center border-b"
        style={{
          backgroundColor: 'var(--secondary)',
          color: '#ffffff',
          borderColor: 'var(--border-color)'
        }}
      >
        <div className="w-4/12 pl-1">Jogador</div>
        <div className="w-3/12 text-center">Nível</div>
        <div className="w-2/12 text-center">Altura</div>
        <div className="w-2/12 text-center">Gênero</div>
        <div className="w-1/12 text-right pr-1"></div>
      </div>

      {/* Sorted Player List */}
      <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
        {sortedPlayers.map((player, index) => {
          const isEven = index % 2 === 0;

          return (
            <div
              key={player.id}
              className="flex p-2.5 items-center text-sm transition-colors gap-1"
              style={{
                backgroundColor: isEven ? 'var(--bg-surface)' : 'var(--bg-subtle)'
              }}
            >
              {/* Editable Name Input */}
              <div className="w-4/12 pl-1">
                <input
                  type="text"
                  value={player.name}
                  onChange={(e) => onUpdatePlayer?.(player.id, 'name', e.target.value)}
                  className="w-full bg-transparent font-semibold border-b border-transparent hover:border-gray-400 focus:border-[var(--primary)] focus:outline-none px-1 py-0.5 rounded text-sm transition-colors"
                  style={{ color: 'var(--text-main)' }}
                  placeholder="Nome do jogador"
                />
              </div>

              {/* Editable Nível (Score) */}
              <div className="w-3/12 text-center">
                <select
                  value={player.score}
                  onChange={(e) => onUpdatePlayer?.(player.id, 'score', Number(e.target.value))}
                  className="border text-xs rounded-lg px-1.5 py-1 outline-none font-bold shadow-sm"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--accent)',
                    borderColor: 'var(--border-color)'
                  }}
                >
                  {[5, 4, 3, 2, 1].map((star) => (
                    <option key={star} value={star}>
                      {star} ⭐
                    </option>
                  ))}
                </select>
              </div>

              {/* Editable Altura (Height) */}
              <div className="w-2/12 text-center">
                <select
                  value={player.height || 'short'}
                  onChange={(e) => onUpdatePlayer?.(player.id, 'height', e.target.value)}
                  className="border text-xs rounded-lg px-1 py-1 outline-none font-medium shadow-sm"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-main)',
                    borderColor: 'var(--border-color)'
                  }}
                >
                  <option value="tall">📏 Alto</option>
                  <option value="short">📐 Baixo</option>
                </select>
              </div>

              {/* Editable Gênero (Gender) */}
              <div className="w-2/12 text-center">
                <select
                  value={player.gender}
                  onChange={(e) => onUpdatePlayer?.(player.id, 'gender', e.target.value)}
                  className="border text-xs rounded-lg px-1 py-1 outline-none font-medium shadow-sm"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-main)',
                    borderColor: 'var(--border-color)'
                  }}
                >
                  <option value="F">👩 Fem</option>
                  <option value="M">👨 Masc</option>
                </select>
              </div>

              {/* Action / Delete Button */}
              <div className="w-1/12 text-right pr-1">
                {onDeletePlayer && (
                  <button
                    onClick={() => onDeletePlayer(player.id)}
                    className="text-gray-400 hover:text-red-500 font-bold p-1 transition-colors text-sm"
                    title="Remover jogador"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}