import React, { useState, useEffect } from 'react';
import PlayerList from './PlayerList';
import GameSessionsView from './GameSessionsView';
import GistSyncPanel from './GistSyncPanel';
import { ENCRYPTED_GITHUB_TOKEN, loadGistState, saveGistState } from './gistService';
import { decryptToken } from './cryptoUtils';
import { appendDraftTeamSession } from './teamGameSessions.js';
import { calcTeamBalancePenalty, prepareTeamDraftPool } from './domain/teamBalance.js';
import { createEmptyGameSessionsDocument } from './persistence/gameSessionsDocument.js';
import {
  applySuccessfulGistLoad,
  applyGistLoadFailure,
  canSaveToGist,
  clearPendingGistChanges,
  getGistGateMessage,
  gistLoadNeedsFetch,
  GIST_LOAD_STRATEGY,
  markPendingGistChanges,
  nextGameSessionsDocument,
  persistLocalGameSessions,
  readLocalGameSessions,
  readPendingGistChanges,
} from './persistence/syncHelpers.js';


const INITIAL_ROSTER = [];

export default function App() {
  // --- Core Navigation & Drawer States ---
  const [currentView, setCurrentView] = useState('draft'); // 'draft', 'players', 'preview', 'history', 'sessions'
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // --- Players & History States ---
  const [players, setPlayers] = useState(() => {
    const saved = localStorage.getItem('volleyPlayers');
    return saved ? JSON.parse(saved) : INITIAL_ROSTER;
  });

  const [draftHistory, setDraftHistory] = useState(() => {
    const saved = localStorage.getItem('volleyDrafts');
    return saved ? JSON.parse(saved) : [];
  });

  // --- Quick Draft States ---
  const [pastedText, setPastedText] = useState('');
  const [sessionPlayers, setSessionPlayers] = useState([]);
  const [teamSize, setTeamSize] = useState(6);
  const [balanceGender, setBalanceGender] = useState(true);
  const [balanceHeight, setBalanceHeight] = useState(true);
  const [newPlayerName, setNewPlayerName] = useState('');

  // --- Draft Preview & History Index ---
  const [draftPreview, setDraftPreview] = useState(null);
  const [currentDraftIndex, setCurrentDraftIndex] = useState(0);

  const [localSessions] = useState(() => readLocalGameSessions());
  const [gameSessions, setGameSessions] = useState(
    () => localSessions.document ?? createEmptyGameSessionsDocument()
  );
  const [localCacheError, setLocalCacheError] = useState(() => localSessions.error);
  const [localWriteError, setLocalWriteError] = useState(() => localSessions.writeError ?? null);

  // --- GitHub Gist Sync States ---
  const [appPassword, setAppPassword] = useState(() => sessionStorage.getItem('app_password') || '');
  const [syncStatus, setSyncStatus] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [gistLoaded, setGistLoaded] = useState(false);
  const [hasPendingGistChanges, setHasPendingGistChanges] = useState(
    () => Boolean(localSessions.migrated) || readPendingGistChanges()
  );
  const [showLoadConflict, setShowLoadConflict] = useState(false);

  const gistGateMessage = getGistGateMessage({ gistLoaded, hasPendingGistChanges });
  const saveEnabled = canSaveToGist({
    gistLoaded,
    isSyncing,
    hasPassword: Boolean(appPassword),
  });

  // LocalStorage Persistence
  useEffect(() => {
    localStorage.setItem('volleyPlayers', JSON.stringify(players));
  }, [players]);

  useEffect(() => {
    localStorage.setItem('volleyDrafts', JSON.stringify(draftHistory));
  }, [draftHistory]);

  const updatePersistedPlayers = (updater) => {
    setPlayers(updater);
    markPendingGistChanges();
    setHasPendingGistChanges(true);
  };

  const applySessionsDocument = (nextDocument) => {
    const persistResult = persistLocalGameSessions(nextDocument);
    setGameSessions(nextDocument);
    markPendingGistChanges();
    setHasPendingGistChanges(true);
    setLocalWriteError(persistResult.ok ? null : persistResult.error);
  };

  const handleCreateGameSession = (input) => {
    const { document: nextDocument } = appendDraftTeamSession(gameSessions, {
      date: input.date,
      name: input.name,
      format: {
        teamSize: input.teamSize,
        teamCount: input.teamCount,
      },
    });
    applySessionsDocument(nextDocument);
  };

  const loadGistWithStrategy = async (strategy) => {
    setShowLoadConflict(false);
    if (!gistLoadNeedsFetch(strategy)) return;

    try {
      setIsSyncing(true);
      setSyncStatus('Carregando do Gist...');
      const remote = await loadGistState();
      const remoteSessions = nextGameSessionsDocument(
        createEmptyGameSessionsDocument(),
        remote.gameSessions
      );
      const result = applySuccessfulGistLoad({
        strategy,
        localPlayers: players,
        localGameSessions: gameSessions,
        remotePlayers: remote.players,
        remoteGameSessions: remoteSessions,
        remoteMigrated: remote.migrated,
      });

      if (result.replaceLocal) {
        const persistResult = persistLocalGameSessions(result.gameSessions);
        setPlayers(result.players);
        setGameSessions(result.gameSessions);
        setLocalCacheError(null);
        setLocalWriteError(persistResult.ok ? null : persistResult.error);
      }

      if (result.hasPendingGistChanges) {
        markPendingGistChanges();
      } else {
        clearPendingGistChanges();
      }

      setHasPendingGistChanges(result.hasPendingGistChanges);
      setGistLoaded(true);
      setSyncStatus(result.syncStatus);
    } catch (err) {
      const failure = applyGistLoadFailure({
        error: err,
        hasPendingGistChanges,
        localPlayers: players,
        localGameSessions: gameSessions,
      });
      setSyncStatus(failure.syncStatus);
    } finally {
      setIsSyncing(false);
    }
  };

  // --- Gist API Handlers ---
  const handleLoadGist = () => {
    if (hasPendingGistChanges) {
      setShowLoadConflict(true);
      return;
    }
    return loadGistWithStrategy(GIST_LOAD_STRATEGY.FRESH);
  };

  // Keep password in sessionStorage so you only type it once per session on any device
  const handlePasswordChange = (e) => {
    const pwd = e.target.value;
    setAppPassword(pwd);
    sessionStorage.setItem('app_password', pwd);
  };

  const handleSaveGist = async () => {
    if (!gistLoaded) {
      setSyncStatus('Carregue o Gist antes de salvar');
      return;
    }

    if (!appPassword) {
      alert('Por favor, digite sua senha de desbloqueio.');
      return;
    }

    let decryptedPat;
    try {
      setIsSyncing(true);
      setSyncStatus('Descriptografando token...');
      decryptedPat = await decryptToken(ENCRYPTED_GITHUB_TOKEN, appPassword);
      setSyncStatus('Salvando no Gist...');
      await saveGistState({
        players,
        gameSessions,
        token: decryptedPat,
      });
      clearPendingGistChanges();
      setHasPendingGistChanges(false);
      setSyncStatus('Salvo no Gist com sucesso!');
    } catch (err) {
      setSyncStatus(`Erro ao salvar: ${err.message}`);
    } finally {
      decryptedPat = undefined;
      setIsSyncing(false);
    }
  };


  // --- Name Matcher ---
  const handleIdentifyPlayers = () => {
    if (!pastedText.trim()) return;

    const normalize = (str) =>
      str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '');

    const cleanText = normalize(pastedText);

    const matched = players.filter((p) => {
      const cleanName = normalize(p.name);
      return cleanName.length >= 2 && cleanText.includes(cleanName);
    });

    setSessionPlayers(matched);
  };

  // --- State Updates ---
  const handleUpdateSessionPlayer = (id, field, value) => {
    setSessionPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
    updatePersistedPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const handleUpdatePlayer = (id, field, value) => {
    updatePersistedPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
    setSessionPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const handleDeletePlayer = (id) => {
    updatePersistedPlayers((prev) => prev.filter((p) => p.id !== id));
    setSessionPlayers((prev) => prev.filter((p) => p.id !== id));
  };

  const handleRemoveFromSession = (id) => {
    setSessionPlayers((prev) => prev.filter((p) => p.id !== id));
  };

  const handleAddQuickPlayer = (e) => {
    e.preventDefault();
    if (!newPlayerName.trim()) return;

    const newP = {
      id: crypto.randomUUID(),
      name: newPlayerName.trim(),
      score: 3,
      gender: 'F',
      height: 'short',
    };

    updatePersistedPlayers((prev) => [...prev, newP]);
    setSessionPlayers((prev) => [...prev, newP]);
    setNewPlayerName('');
  };

  // --- Monte Carlo Draft Generator ---
  const runMonteCarloDraft = () => {
    const { numTeams, playersToDraft, bench } = prepareTeamDraftPool(sessionPlayers, teamSize);
    if (numTeams < 2) {
      alert(`Selecione pelo menos ${teamSize * 2} jogadores para formar dois times de ${teamSize}!`);
      return;
    }

    let bestTeams = null;
    let minPenalty = Infinity;

    for (let i = 0; i < 10000; i++) {
      const shuffled = [...playersToDraft].sort(() => Math.random() - 0.5);
      const candidateTeams = Array.from({ length: numTeams }, (_, idx) =>
        shuffled.slice(idx * teamSize, (idx + 1) * teamSize)
      );

      const penalty = calcTeamBalancePenalty(candidateTeams, { balanceGender, balanceHeight });
      if (penalty < minPenalty) {
        minPenalty = penalty;
        bestTeams = candidateTeams;
        if (minPenalty === 0) break;
      }
    }

    const result = {
      id: crypto.randomUUID(),
      date: new Date().toLocaleString('pt-BR'),
      teams: bestTeams,
      format: `${teamSize}x${teamSize}`,
      bench,
    };

    setDraftPreview(result);
    setCurrentView('preview');
  };

  const handleConfirmDraft = () => {
    if (!draftPreview) return;
    setDraftHistory([draftPreview, ...draftHistory]);
    setCurrentDraftIndex(0);
    setDraftPreview(null);
    setCurrentView('history');
  };

  const gistSyncPanel = (
    <GistSyncPanel
      password={appPassword}
      onPasswordChange={handlePasswordChange}
      onLoad={handleLoadGist}
      onSave={handleSaveGist}
      isSyncing={isSyncing}
      saveEnabled={saveEnabled}
      gistGateMessage={gistGateMessage}
      syncStatus={syncStatus}
      localCacheError={localCacheError}
      localWriteError={localWriteError}
      showLoadConflict={showLoadConflict}
      onKeepLocalChanges={() => loadGistWithStrategy(GIST_LOAD_STRATEGY.KEEP_LOCAL)}
      onUseRemoteData={() => loadGistWithStrategy(GIST_LOAD_STRATEGY.USE_REMOTE)}
      onCancelLoad={() => setShowLoadConflict(false)}
    />
  );

  return (
    <div
      className="min-h-screen font-sans transition-colors"
      style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
    >
      <div
        className="max-w-2xl mx-auto min-h-screen flex flex-col border-x shadow-2xl relative"
        style={{ backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)' }}
      >
        {/* Header */}
        <header
          className="p-4 flex justify-between items-center border-b shadow-sm"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
        >
          <h1
            onClick={() => setCurrentView('draft')}
            className="text-2xl font-black tracking-wide cursor-pointer flex items-center gap-2"
          >
            🏐 Cortada
          </h1>
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-2 text-2xl focus:outline-none cursor-pointer"
          >
            ☰
          </button>
        </header>

        {/* Navigation Menu Drawer */}
        {isMenuOpen && (
          <div
            className="flex flex-col p-2 space-y-1 border-b shadow-inner"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
          >
            <button
              onClick={() => { setCurrentView('draft'); setIsMenuOpen(false); }}
              className="p-3 text-left font-semibold rounded-lg transition-colors cursor-pointer"
              style={{
                backgroundColor: currentView === 'draft' ? 'var(--bg-subtle)' : 'transparent',
                color: 'var(--text-main)'
              }}
            >
              ⚡ Sorteio Rápido
            </button>
            <button
              onClick={() => { setCurrentView('players'); setIsMenuOpen(false); }}
              className="p-3 text-left font-semibold rounded-lg transition-colors cursor-pointer"
              style={{
                backgroundColor: currentView === 'players' ? 'var(--bg-subtle)' : 'transparent',
                color: 'var(--text-main)'
              }}
            >
              👥 Elenco Completo ({players.length})
            </button>
            <button
              onClick={() => { setCurrentView('sessions'); setIsMenuOpen(false); }}
              className="p-3 text-left font-semibold rounded-lg transition-colors cursor-pointer"
              style={{
                backgroundColor: currentView === 'sessions' ? 'var(--bg-subtle)' : 'transparent',
                color: 'var(--text-main)'
              }}
            >
              🗓️ Encontros
            </button>
            <button
              onClick={() => {
                if (draftHistory.length === 0) return alert('Nenhum sorteio salvo!');
                setCurrentDraftIndex(0);
                setCurrentView('history');
                setIsMenuOpen(false);
              }}
              className="p-3 text-left font-semibold rounded-lg transition-colors cursor-pointer"
              style={{
                backgroundColor: currentView === 'history' ? 'var(--bg-subtle)' : 'transparent',
                color: 'var(--text-main)'
              }}
            >
              📜 Histórico de Sorteios
            </button>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 p-4 overflow-y-auto space-y-4">

          {/* 1. DRAFT VIEW */}
          {currentView === 'draft' && (
            <div className="space-y-4">
              {/* WhatsApp Textarea */}
              <div
                className="p-3 rounded-xl border space-y-2"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
              >
                <label className="block text-sm font-bold" style={{ color: 'var(--text-main)' }}>
                  Cole a lista de confirmados (WhatsApp):
                </label>
                <textarea
                  rows="3"
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Ex: 1- Lucas, 2- Camila, Mariana confirmed, Gabriel..."
                  className="w-full border rounded-lg p-2 text-sm outline-none"
                  style={{
                    backgroundColor: 'var(--bg-app)',
                    color: 'var(--text-main)',
                    borderColor: 'var(--border-color)'
                  }}
                />
                <button
                  onClick={handleIdentifyPlayers}
                  className="w-full font-bold py-2 rounded-lg text-sm transition cursor-pointer"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
                >
                  🔍 Identificar Jogadores
                </button>
              </div>

              {/* Matched Session Players */}
              {sessionPlayers.length > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <span className="font-bold text-sm">
                      Jogadores na Mesa ({sessionPlayers.length})
                    </span>
                    <button
                      onClick={() => setSessionPlayers([])}
                      className="text-xs text-red-500 font-bold cursor-pointer"
                    >
                      Limpar Tudo
                    </button>
                  </div>

                  <PlayerList
                    players={sessionPlayers}
                    onUpdatePlayer={handleUpdateSessionPlayer}
                    onDeletePlayer={handleRemoveFromSession}
                  />
                </div>
              )}

              {/* Add Quick Player */}
              <form onSubmit={handleAddQuickPlayer} className="flex gap-2">
                <input
                  type="text"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  placeholder="Nome de outro jogador..."
                  className="flex-1 border rounded-lg p-2 text-sm outline-none"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-main)',
                    borderColor: 'var(--border-color)'
                  }}
                />
                <button
                  type="submit"
                  className="text-xs font-bold px-4 rounded-lg cursor-pointer"
                  style={{ backgroundColor: 'var(--secondary)', color: '#ffffff' }}
                >
                  + Add
                </button>
              </form>

              {/* Game Format & Settings */}
              <div
                className="p-3 rounded-xl border space-y-3"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
              >
                <div>
                  <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-muted)' }}>
                    FORMATO DO JOGO
                  </label>
                  <div className="flex rounded-lg p-1 gap-1" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                    {[2, 3, 4, 5, 6].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setTeamSize(n)}
                        className="flex-1 py-1 text-xs font-bold rounded-md transition cursor-pointer"
                        style={{
                          backgroundColor: teamSize === n ? 'var(--primary)' : 'transparent',
                          color: teamSize === n ? 'var(--text-inverse)' : 'var(--text-muted)'
                        }}
                      >
                        {n}x{n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBalanceGender(!balanceGender)}
                    className="py-2 px-2 text-xs font-bold rounded-lg border transition cursor-pointer"
                    style={{
                      backgroundColor: balanceGender ? 'var(--bg-subtle)' : 'transparent',
                      borderColor: balanceGender ? 'var(--primary)' : 'var(--border-color)',
                      color: 'var(--text-main)'
                    }}
                  >
                    👩/👨 Gênero {balanceGender ? '✓' : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBalanceHeight(!balanceHeight)}
                    className="py-2 px-2 text-xs font-bold rounded-lg border transition cursor-pointer"
                    style={{
                      backgroundColor: balanceHeight ? 'var(--bg-subtle)' : 'transparent',
                      borderColor: balanceHeight ? 'var(--primary)' : 'var(--border-color)',
                      color: 'var(--text-main)'
                    }}
                  >
                    📏 Altura {balanceHeight ? '✓' : ''}
                  </button>
                </div>
              </div>

              {/* Main CTA Button */}
              <button
                onClick={runMonteCarloDraft}
                className="w-full font-bold py-3.5 rounded-xl text-lg shadow-lg transition cursor-pointer"
                style={{ backgroundColor: 'var(--accent)', color: '#ffffff' }}
              >
                Sortear Times!
              </button>
            </div>
          )}

          {/* 2. PREVIEW VIEW */}
          {currentView === 'preview' && draftPreview && (
            <div className="space-y-4 pb-12">
              <h2 className="text-xl font-bold text-center">Prévia do Sorteio</h2>

              {draftPreview.teams.map((team, idx) => {
                const scoreSum = team.reduce((a, b) => a + b.score, 0);
                return (
                  <div
                    key={idx}
                    className="border rounded-xl overflow-hidden shadow-sm"
                    style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
                  >
                    <div
                      className="p-2 flex justify-between items-center border-b"
                      style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}
                    >
                      <span className="font-bold">Time {idx + 1}</span>
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded"
                        style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
                      >
                        Força: {scoreSum}
                      </span>
                    </div>
                    <div className="p-2 space-y-1">
                      {team.map((p) => (
                        <div key={p.id} className="flex justify-between text-sm py-1 border-b last:border-0" style={{ borderColor: 'var(--border-color)' }}>
                          <span>{p.name} {p.gender === 'F' ? '👩' : '👨'} ({p.height === 'tall' ? 'Alto' : 'Baixo'})</span>
                          <span className="font-bold" style={{ color: 'var(--accent)' }}>{p.score}⭐</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="flex gap-2 pt-4">
                <button
                  onClick={runMonteCarloDraft}
                  className="flex-1 font-bold py-3 rounded-xl border cursor-pointer"
                  style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
                >
                  🔄 Refazer
                </button>
                <button
                  onClick={handleConfirmDraft}
                  className="flex-1 font-bold py-3 rounded-xl shadow-md cursor-pointer"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
                >
                  ✅ Confirmar
                </button>
              </div>
            </div>
          )}

          {/* 3. ROSTER MANAGEMENT & GIST SYNC VIEW */}
          {currentView === 'players' && (
            <div className="space-y-4">
              {gistSyncPanel}

              <h2 className="text-xl font-bold">Elenco Registrado ({players.length})</h2>

              <PlayerList
                players={players}
                onUpdatePlayer={handleUpdatePlayer}
                onDeletePlayer={handleDeletePlayer}
              />
            </div>
          )}

          {currentView === 'sessions' && (
            <GameSessionsView
              sessions={gameSessions.sessions}
              sessionsDocument={gameSessions}
              players={players}
              onCreateSession={handleCreateGameSession}
              onApplyDocument={applySessionsDocument}
              syncPanel={gistSyncPanel}
            />
          )}

          {/* 4. HISTORY VIEW */}
          {currentView === 'history' && draftHistory.length > 0 && (
            <div className="space-y-4">
              <div
                className="flex justify-between items-center p-2 rounded-xl border"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
              >
                <button
                  onClick={() => setCurrentDraftIndex(Math.min(currentDraftIndex + 1, draftHistory.length - 1))}
                  disabled={currentDraftIndex === draftHistory.length - 1}
                  className="p-2 font-bold cursor-pointer disabled:opacity-30"
                  style={{ color: 'var(--primary)' }}
                >
                  ← Anterior
                </button>
                <span className="text-xs text-gray-400">{draftHistory[currentDraftIndex].date}</span>
                <button
                  onClick={() => setCurrentDraftIndex(Math.max(currentDraftIndex - 1, 0))}
                  disabled={currentDraftIndex === 0}
                  className="p-2 font-bold cursor-pointer disabled:opacity-30"
                  style={{ color: 'var(--primary)' }}
                >
                  Próximo →
                </button>
              </div>

              {draftHistory[currentDraftIndex].teams.map((team, idx) => (
                <div
                  key={idx}
                  className="border rounded-xl p-3 space-y-1"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
                >
                  <h3 className="font-bold border-b pb-1" style={{ color: 'var(--primary)', borderColor: 'var(--border-color)' }}>
                    Time {idx + 1}
                  </h3>
                  {team.map((p) => (
                    <div key={p.id} className="flex justify-between text-sm py-1">
                      <span>{p.name}</span>
                      <span style={{ color: 'var(--accent)' }}>{p.score}⭐</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

        </main>
      </div>
    </div>
  );
}