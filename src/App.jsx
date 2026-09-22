import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PlayerList from './PlayerList';
import CloudSessionsView from './CloudSessionsView.jsx';
import CloudGroupsView from './CloudGroupsView.jsx';
import CloudCompetitionsView from './CloudCompetitionsView.jsx';
import CloudProfileView from './CloudProfileView.jsx';
import JoinSessionView from './JoinSessionView.jsx';
import JoinGroupView from './JoinGroupView.jsx';
import JoinCompetitionView from './JoinCompetitionView.jsx';
import LegacyMigrationView from './LegacyMigrationView.jsx';
import AuthPanel from './AuthPanel.jsx';
import useAuth from './hooks/useAuth.js';
import {
  clearPendingCompetitionJoinCode,
  clearPendingGroupJoinCode,
  clearPendingJoinCode,
  parseCompetitionJoinHash,
  parseGroupJoinHash,
  parseJoinHash,
  rememberPendingCompetitionJoinCode,
  rememberPendingGroupJoinCode,
  rememberPendingJoinCode,
  resolveIncomingJoinIntent,
} from './supabase/joinCode.js';
import { createPlayer } from './players.js';
import { calcTeamBalancePenalty, prepareTeamDraftPool } from './domain/teamBalance.js';
import { DRAFTS_STORAGE_KEY, hasLocalLegacyData } from './migration/legacy/localLegacyReader.js';

const DRAFT_VIEWS = new Set(['draft', 'preview', 'history']);

function readDraftHistory() {
  try {
    const saved = globalThis.localStorage?.getItem?.(DRAFTS_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function namesFromPastedText(text) {
  return String(text ?? '')
    .split(/[\n,;]+/)
    .map((line) => line.replace(/^\s*\d+\s*[).\-:]\s*/, '').trim())
    .filter((name) => name.length >= 2);
}

function LegacyBrowserNotice({ visible, onOpenMigration }) {
  if (!visible) return null;
  return (
    <div
      className="p-3 rounded-xl border space-y-2"
      style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}
    >
      <p className="text-sm font-semibold">Encontramos dados antigos neste navegador.</p>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Eles não entram no app automaticamente. Importe se quiser usá-los em encontros e competições.
      </p>
      <button
        type="button"
        onClick={onOpenMigration}
        className="w-full font-bold py-2 rounded-lg text-sm cursor-pointer"
        style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
      >
        Importar dados antigos
      </button>
    </div>
  );
}

export default function App() {
  const [currentView, setCurrentView] = useState('sessions');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const auth = useAuth();
  const [cloudSessionId, setCloudSessionId] = useState(null);
  const [cloudGroupId, setCloudGroupId] = useState(null);
  const [cloudCompetitionId, setCloudCompetitionId] = useState(null);
  const [pendingJoinCode, setPendingJoinCode] = useState(() => {
    const intent = resolveIncomingJoinIntent({
      hash: globalThis.location?.hash ?? '',
      search: globalThis.location?.search ?? '',
    });
    return intent.type === 'session' ? intent.code : null;
  });
  const [pendingGroupJoinCode, setPendingGroupJoinCode] = useState(() => {
    const intent = resolveIncomingJoinIntent({
      hash: globalThis.location?.hash ?? '',
      search: globalThis.location?.search ?? '',
    });
    return intent.type === 'group' ? intent.code : null;
  });
  const [pendingCompetitionJoinCode, setPendingCompetitionJoinCode] = useState(() => {
    const intent = resolveIncomingJoinIntent({
      hash: globalThis.location?.hash ?? '',
      search: globalThis.location?.search ?? '',
    });
    return intent.type === 'competition' ? intent.code : null;
  });
  const foundLegacy = useMemo(() => hasLocalLegacyData(), []);

  const [draftHistory, setDraftHistory] = useState(readDraftHistory);
  const [pastedText, setPastedText] = useState('');
  const [sessionPlayers, setSessionPlayers] = useState([]);
  const [teamSize, setTeamSize] = useState(6);
  const [balanceGender, setBalanceGender] = useState(true);
  const [balanceHeight, setBalanceHeight] = useState(true);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [draftPreview, setDraftPreview] = useState(null);
  const [currentDraftIndex, setCurrentDraftIndex] = useState(0);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem?.(DRAFTS_STORAGE_KEY, JSON.stringify(draftHistory));
    } catch {
      // UI cache only
    }
  }, [draftHistory]);

  const openMigration = useCallback(() => {
    setCurrentView('migration');
    if (globalThis.location) globalThis.location.hash = '#/migration';
    setIsMenuOpen(false);
  }, []);

  useEffect(() => {
    const intent = resolveIncomingJoinIntent({
      hash: globalThis.location?.hash ?? '',
      search: globalThis.location?.search ?? '',
    });
    if (intent.type === 'competition') {
      rememberPendingCompetitionJoinCode(intent.code);
      setPendingCompetitionJoinCode(intent.code);
      setCurrentView('competitionJoin');
    } else if (intent.type === 'group') {
      rememberPendingGroupJoinCode(intent.code);
      setPendingGroupJoinCode(intent.code);
      setCurrentView('groupJoin');
    } else if (intent.type === 'session') {
      rememberPendingJoinCode(intent.code);
      setPendingJoinCode(intent.code);
      setCurrentView('join');
    } else if ((globalThis.location?.hash ?? '') === '#/migration' || (globalThis.location?.hash ?? '').startsWith('#/migration')) {
      setCurrentView('migration');
    }

    const onHashChange = () => {
      const hash = globalThis.location?.hash ?? '';
      if (hash === '#/migration' || hash.startsWith('#/migration')) {
        setCurrentView('migration');
        return;
      }
      const competitionCode = parseCompetitionJoinHash(hash);
      if (competitionCode) {
        rememberPendingCompetitionJoinCode(competitionCode);
        setPendingCompetitionJoinCode(competitionCode);
        setCurrentView('competitionJoin');
        return;
      }
      const groupCode = parseGroupJoinHash(globalThis.location?.hash ?? '');
      if (groupCode) {
        rememberPendingGroupJoinCode(groupCode);
        setPendingGroupJoinCode(groupCode);
        setCurrentView('groupJoin');
        return;
      }
      const code = parseJoinHash(globalThis.location?.hash ?? '');
      if (!code) return;
      rememberPendingJoinCode(code);
      setPendingJoinCode(code);
      setCurrentView('join');
    };
    globalThis.addEventListener?.('hashchange', onHashChange);
    return () => globalThis.removeEventListener?.('hashchange', onHashChange);
  }, []);

  const handleJoinedCloudSession = useCallback((sessionId) => {
    clearPendingJoinCode();
    setPendingJoinCode(null);
    setCloudSessionId(sessionId);
    setCurrentView('sessions');
    const url = new URL(globalThis.location.href);
    url.searchParams.delete('join');
    if (url.hash.startsWith('#/join/')) url.hash = '';
    globalThis.history?.replaceState?.({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const handleJoinedCloudGroup = useCallback((groupId) => {
    clearPendingGroupJoinCode();
    setPendingGroupJoinCode(null);
    setCloudGroupId(groupId);
    setCurrentView('groups');
    const url = new URL(globalThis.location.href);
    url.searchParams.delete('groupJoin');
    if (url.hash.startsWith('#/group/join/')) url.hash = '';
    globalThis.history?.replaceState?.({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const handleJoinedCloudCompetition = useCallback((competitionId) => {
    clearPendingCompetitionJoinCode();
    setPendingCompetitionJoinCode(null);
    setCloudCompetitionId(competitionId);
    setCurrentView('competitions');
    const url = new URL(globalThis.location.href);
    url.searchParams.delete('competitionJoin');
    if (url.hash.startsWith('#/competition/join/')) url.hash = '';
    globalThis.history?.replaceState?.({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const handleIdentifyPlayers = () => {
    if (!pastedText.trim()) return;
    const names = namesFromPastedText(pastedText);
    let next = [...sessionPlayers];
    for (const name of names) {
      const existing = next.find(
        (player) => player.name.toLowerCase() === name.toLowerCase()
      );
      if (existing) continue;
      const created = createPlayer(next, {
        name,
        score: 3,
        gender: 'F',
        height: 'short',
      });
      if (created?.ok) next = created.players;
    }
    setSessionPlayers(next);
  };

  const handleAddQuickPlayer = (event) => {
    event.preventDefault();
    if (!newPlayerName.trim()) return;
    const result = createPlayer(sessionPlayers, {
      name: newPlayerName.trim(),
      score: 3,
      gender: 'F',
      height: 'short',
    });
    if (!result?.ok) return;
    setSessionPlayers(result.players);
    setNewPlayerName('');
  };

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

    setDraftPreview({
      id: crypto.randomUUID(),
      date: new Date().toLocaleString('pt-BR'),
      teams: bestTeams,
      format: `${teamSize}x${teamSize}`,
      bench,
    });
    setCurrentView('preview');
  };

  const handleConfirmDraft = () => {
    if (!draftPreview) return;
    setDraftHistory([draftPreview, ...draftHistory]);
    setCurrentDraftIndex(0);
    setDraftPreview(null);
    setCurrentView('history');
  };

  const go = (view) => {
    setCurrentView(view);
    setIsMenuOpen(false);
  };

  return (
    <div
      className="min-h-screen font-sans transition-colors"
      style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
    >
      <div
        className="max-w-2xl mx-auto min-h-screen flex flex-col border-x shadow-2xl relative"
        style={{ backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)' }}
      >
        <header
          className="p-4 flex justify-between items-center border-b shadow-sm"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
        >
          <h1
            onClick={() => setCurrentView('sessions')}
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

        {isMenuOpen && (
          <div
            className="flex flex-col p-2 space-y-1 border-b shadow-inner"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
          >
            <button
              type="button"
              onClick={() => go('sessions')}
              className="p-3 text-left font-semibold rounded-lg transition-colors cursor-pointer"
              style={{
                backgroundColor: currentView === 'sessions' || currentView === 'join' ? 'var(--bg-subtle)' : 'transparent',
                color: 'var(--text-main)',
              }}
              aria-current={currentView === 'sessions' || currentView === 'join' ? 'page' : undefined}
            >
              🗓️ Encontros
            </button>
            <button
              type="button"
              onClick={() => go('competitions')}
              className="p-3 text-left font-semibold rounded-lg transition-colors cursor-pointer"
              style={{
                backgroundColor:
                  currentView === 'competitions' || currentView === 'competitionJoin' ? 'var(--bg-subtle)' : 'transparent',
                color: 'var(--text-main)',
              }}
              aria-current={currentView === 'competitions' || currentView === 'competitionJoin' ? 'page' : undefined}
            >
              🏆 Competições
            </button>
            <button
              type="button"
              onClick={() => go('groups')}
              className="p-3 text-left font-semibold rounded-lg transition-colors cursor-pointer"
              style={{
                backgroundColor: currentView === 'groups' || currentView === 'groupJoin' ? 'var(--bg-subtle)' : 'transparent',
                color: 'var(--text-main)',
              }}
              aria-current={currentView === 'groups' || currentView === 'groupJoin' ? 'page' : undefined}
            >
              🏠 Grupos
            </button>
            <button
              type="button"
              onClick={() => go('profile')}
              className="p-3 text-left font-semibold rounded-lg transition-colors cursor-pointer"
              style={{
                backgroundColor: currentView === 'profile' ? 'var(--bg-subtle)' : 'transparent',
                color: 'var(--text-main)',
              }}
              aria-current={currentView === 'profile' ? 'page' : undefined}
            >
              👤 Perfil
            </button>
            <button
              type="button"
              onClick={() => go('draft')}
              className="p-3 text-left font-semibold rounded-lg transition-colors cursor-pointer"
              style={{
                backgroundColor: DRAFT_VIEWS.has(currentView) ? 'var(--bg-subtle)' : 'transparent',
                color: 'var(--text-main)',
              }}
            >
              ⚡ Sorteio rápido
            </button>
            {auth.user ? (
              <button
                type="button"
                onClick={openMigration}
                className="p-3 text-left font-semibold rounded-lg transition-colors cursor-pointer"
                style={{
                  backgroundColor: currentView === 'migration' ? 'var(--bg-subtle)' : 'transparent',
                  color: 'var(--text-main)',
                }}
                aria-current={currentView === 'migration' ? 'page' : undefined}
              >
                ⬆️ Importar dados antigos
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (draftHistory.length === 0) return alert('Nenhum sorteio salvo!');
                setCurrentDraftIndex(0);
                go('history');
              }}
              className="p-3 text-left font-semibold rounded-lg transition-colors cursor-pointer"
              style={{
                backgroundColor: currentView === 'history' ? 'var(--bg-subtle)' : 'transparent',
                color: 'var(--text-main)',
              }}
            >
              📜 Histórico de sorteios
            </button>
          </div>
        )}

        <main className="flex-1 p-4 overflow-y-auto space-y-4">
          {currentView === 'draft' && (
            <div className="space-y-4">
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
                    borderColor: 'var(--border-color)',
                  }}
                />
                <button
                  onClick={handleIdentifyPlayers}
                  className="w-full font-bold py-2 rounded-lg text-sm transition cursor-pointer"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
                >
                  🔍 Identificar jogadores
                </button>
              </div>

              {sessionPlayers.length > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <span className="font-bold text-sm">
                      Jogadores na mesa ({sessionPlayers.length})
                    </span>
                    <button
                      onClick={() => setSessionPlayers([])}
                      className="text-xs text-red-500 font-bold cursor-pointer"
                    >
                      Limpar tudo
                    </button>
                  </div>
                  <PlayerList
                    variant="session"
                    players={sessionPlayers}
                    onDeletePlayer={(id) => setSessionPlayers((prev) => prev.filter((player) => player.id !== id))}
                  />
                </div>
              )}

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
                    borderColor: 'var(--border-color)',
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
                          color: teamSize === n ? 'var(--text-inverse)' : 'var(--text-muted)',
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
                      color: 'var(--text-main)',
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
                      color: 'var(--text-main)',
                    }}
                  >
                    📏 Altura {balanceHeight ? '✓' : ''}
                  </button>
                </div>
              </div>

              <button
                onClick={runMonteCarloDraft}
                className="w-full font-bold py-3.5 rounded-xl text-lg shadow-lg transition cursor-pointer"
                style={{ backgroundColor: 'var(--accent)', color: '#ffffff' }}
              >
                Sortear times!
              </button>
            </div>
          )}

          {currentView === 'preview' && draftPreview && (
            <div className="space-y-4 pb-12">
              <h2 className="text-xl font-bold text-center">Prévia do sorteio</h2>
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

          {currentView === 'join' && (
            <JoinSessionView
              joinCode={pendingJoinCode}
              configured={auth.configured}
              ready={auth.ready}
              user={auth.user}
              onJoined={handleJoinedCloudSession}
            />
          )}

          {currentView === 'groupJoin' && (
            <JoinGroupView
              joinCode={pendingGroupJoinCode}
              configured={auth.configured}
              ready={auth.ready}
              user={auth.user}
              onJoined={handleJoinedCloudGroup}
            />
          )}

          {currentView === 'competitionJoin' && (
            <JoinCompetitionView
              joinCode={pendingCompetitionJoinCode}
              configured={auth.configured}
              ready={auth.ready}
              user={auth.user}
              onJoined={handleJoinedCloudCompetition}
            />
          )}

          {currentView === 'sessions' && (
            <CloudSessionsView
              configured={auth.configured}
              ready={auth.ready}
              user={auth.user}
              pendingJoinCode={pendingJoinCode}
              openSessionId={cloudSessionId}
              onOpenSession={setCloudSessionId}
              legacyNotice={
                <LegacyBrowserNotice visible={Boolean(auth.user && foundLegacy)} onOpenMigration={openMigration} />
              }
            />
          )}

          {currentView === 'groups' && (
            <CloudGroupsView
              configured={auth.configured}
              ready={auth.ready}
              user={auth.user}
              pendingGroupJoinCode={pendingGroupJoinCode}
              openGroupId={cloudGroupId}
              onOpenGroup={setCloudGroupId}
              onOpenSession={(sessionId) => {
                setCloudSessionId(sessionId);
                setCurrentView('sessions');
              }}
              onOpenCompetition={(competitionId) => {
                setCloudCompetitionId(competitionId);
                setCurrentView('competitions');
              }}
            />
          )}

          {currentView === 'competitions' && (
            <CloudCompetitionsView
              configured={auth.configured}
              ready={auth.ready}
              user={auth.user}
              pendingCompetitionJoinCode={pendingCompetitionJoinCode}
              openCompetitionId={cloudCompetitionId}
              onOpenCompetition={setCloudCompetitionId}
            />
          )}

          {currentView === 'profile' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Perfil</h2>
              <AuthPanel configured={auth.configured} ready={auth.ready} user={auth.user} onOpenMigration={openMigration} />
              <LegacyBrowserNotice visible={Boolean(auth.user && foundLegacy)} onOpenMigration={openMigration} />
              {auth.user ? <CloudProfileView user={auth.user} /> : null}
            </div>
          )}

          {currentView === 'migration' && (
            <LegacyMigrationView
              configured={auth.configured}
              ready={auth.ready}
              user={auth.user}
              onBack={() => {
                setCurrentView('sessions');
                if ((globalThis.location?.hash ?? '').startsWith('#/migration')) {
                  const url = new URL(globalThis.location.href);
                  url.hash = '';
                  globalThis.history?.replaceState?.({}, '', `${url.pathname}${url.search}`);
                }
              }}
            />
          )}

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
                  className="p-2 font-bold cursor-pointer"
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
