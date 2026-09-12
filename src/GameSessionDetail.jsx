import React from 'react';
import PairBuilder from './PairBuilder.jsx';
import {
  addSessionPair,
  formatSessionDate,
  removeSessionPair,
  sessionDisplayName,
  sessionListStats,
  translateSessionStatus,
  updateSessionPair,
} from './gameSessions.js';

export default function GameSessionDetail({
  session,
  sessionsDocument,
  players = [],
  syncPanel,
  onBack,
  onApplyDocument,
}) {
  const { pairCount } = sessionListStats(session);

  const applyPairChange = (result) => {
    if (result?.ok) onApplyDocument?.(result.document);
    return result;
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="font-bold text-sm py-2 cursor-pointer"
        style={{ color: 'var(--primary)' }}
      >
        ← Voltar para encontros
      </button>

      <h2 className="text-xl font-bold">{sessionDisplayName(session)}</h2>

      {syncPanel}

      <div
        className="p-4 rounded-xl border space-y-1"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {formatSessionDate(session.date)}
        </p>
        <p className="text-sm font-semibold">{translateSessionStatus(session.status)}</p>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {pairCount} {pairCount === 1 ? 'dupla' : 'duplas'}
        </p>
      </div>

      <PairBuilder
        session={session}
        roster={players}
        onAddPair={(playerA, playerB) =>
          applyPairChange(addSessionPair(sessionsDocument, session.id, { playerA, playerB }, players))
        }
        onUpdatePair={(pairId, playerA, playerB) =>
          applyPairChange(
            updateSessionPair(sessionsDocument, session.id, pairId, { playerA, playerB }, players)
          )
        }
        onRemovePair={(pairId) =>
          applyPairChange(removeSessionPair(sessionsDocument, session.id, pairId, players))
        }
      />
    </div>
  );
}
