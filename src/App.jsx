import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import PlayerList from './PlayerList';
import CloudSessionsView from './CloudSessionsView.jsx';
import JoinSessionView from './JoinSessionView.jsx';
import JoinGroupView from './JoinGroupView.jsx';
import JoinCompetitionView from './JoinCompetitionView.jsx';
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
import { signOut } from './supabase/auth.js';
import { hasBrowserLegacyHint } from './hasBrowserLegacyHint.js';
import { isCommunityBetaEnabled } from './community/flags.js';
import { communityHash, parseCommunityHash, playerProfileHash } from './community/hash.js';
import AppShell from './ui/AppShell.jsx';
import Button from './ui/Button.jsx';
import LoadingState from './ui/LoadingState.jsx';
import { BRAND_NAME, documentTitleForView } from './ui/brand.js';

const CloudGroupsView = lazy(() => import('./CloudGroupsView.jsx'));
const CloudCompetitionsView = lazy(() => import('./CloudCompetitionsView.jsx'));
const CloudProfileView = lazy(() => import('./CloudProfileView.jsx'));
const LegacyMigrationView = lazy(() => import('./LegacyMigrationView.jsx'));
const CommunityView = lazy(() => import('./community/CommunityView.jsx'));
const PlayerProfileView = lazy(() => import('./community/PlayerProfileView.jsx'));

const DRAFTS_STORAGE_KEY = 'volleyDrafts';
const DRAFT_VIEWS = new Set(['draft', 'preview', 'history']);
const JOIN_VIEWS = new Set(['join', 'groupJoin', 'competitionJoin']);

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
      className="p-4 rounded-2xl border space-y-2"
      style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}
    >
      <p className="text-small font-semibold">Encontramos dados antigos neste navegador.</p>
      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
        Eles não entram no app automaticamente. Importe se quiser usá-los em encontros e competições.
      </p>
      <Button onClick={onOpenMigration} className="w-full">
        Importar dados antigos
      </Button>
    </div>
  );
}

function RouteFallback() {
  return <LoadingState label="Carregando..." rows={2} />;
}

export default function App() {
  const [currentView, setCurrentView] = useState('sessions');
  const auth = useAuth();
  const [cloudSessionId, setCloudSessionId] = useState(null);
  const [cloudGroupId, setCloudGroupId] = useState(null);
  const [cloudCompetitionId, setCloudCompetitionId] = useState(null);
  const [communitySection, setCommunitySection] = useState('friends');
  const [playerProfileId, setPlayerProfileId] = useState(null);
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
  const foundLegacy = useMemo(() => hasBrowserLegacyHint(), []);

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

  useEffect(() => {
    if (globalThis.document) globalThis.document.title = documentTitleForView(currentView);
  }, [currentView]);

  const openMigration = useCallback(() => {
    setCurrentView('migration');
    if (globalThis.location) globalThis.location.hash = '#/migration';
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
    } else if (isCommunityBetaEnabled()) {
      const community = parseCommunityHash(globalThis.location?.hash ?? '');
      if (community?.view === 'player') {
        setPlayerProfileId(community.playerId);
        setCurrentView('player');
      } else if (community?.view === 'community') {
        setCommunitySection(community.section);
        setCurrentView('community');
      }
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
      if (code) {
        rememberPendingJoinCode(code);
        setPendingJoinCode(code);
        setCurrentView('join');
        return;
      }
      if (isCommunityBetaEnabled()) {
        const community = parseCommunityHash(hash);
        if (community?.view === 'player') {
          setPlayerProfileId(community.playerId);
          setCurrentView('player');
          return;
        }
        if (community?.view === 'community') {
          setCommunitySection(community.section);
          setCurrentView('community');
        }
      }
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
      const existing = next.find((player) => player.name.toLowerCase() === name.toLowerCase());
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
      setCurrentView('draft');
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

  const openPlayerProfile = useCallback((playerId) => {
    if (!playerId || !isCommunityBetaEnabled()) return;
    setPlayerProfileId(playerId);
    setCurrentView('player');
    if (globalThis.location) globalThis.location.hash = playerProfileHash(playerId);
  }, []);

  const go = (view) => {
    if (view === 'history' && draftHistory.length === 0) {
      setCurrentView('draft');
      return;
    }
    if (view === 'community' && isCommunityBetaEnabled()) {
      setCurrentView('community');
      if (globalThis.location) globalThis.location.hash = communityHash(communitySection);
      return;
    }
    setCurrentView(view);
    if (
      globalThis.location &&
      (parseCommunityHash(globalThis.location.hash)?.view === 'community' ||
        parseCommunityHash(globalThis.location.hash)?.view === 'player')
    ) {
      const url = new URL(globalThis.location.href);
      url.hash = '';
      globalThis.history?.replaceState?.({}, '', `${url.pathname}${url.search}`);
    }
  };

  const showPrimaryNav = Boolean(auth.user) && !JOIN_VIEWS.has(currentView) && currentView !== 'migration';
  const showLanding = !auth.user && !JOIN_VIEWS.has(currentView) && !DRAFT_VIEWS.has(currentView) && currentView !== 'migration';

  return (
    <AppShell
      currentView={currentView}
      user={auth.user}
      onNavigate={go}
      onOpenMigration={auth.user ? openMigration : undefined}
      onSignOut={async () => {
        await signOut();
      }}
      showPrimaryNav={showPrimaryNav}
      communityEnabled={Boolean(auth.user && isCommunityBetaEnabled())}
    >
      {showLanding ? (
        <AuthPanel
          configured={auth.configured}
          ready={auth.ready}
          user={auth.user}
          pendingJoinCode={pendingJoinCode}
          pendingGroupJoinCode={pendingGroupJoinCode}
          pendingCompetitionJoinCode={pendingCompetitionJoinCode}
        />
      ) : null}

      {currentView === 'draft' && (
        <div className="space-y-4">
          <h2 className="text-h1">Sorteio rápido</h2>
          <p className="text-small" style={{ color: 'var(--text-muted)' }}>
            Ferramenta local deste aparelho. Não grava encontro no {BRAND_NAME}.
          </p>
          <div
            className="p-4 rounded-2xl border space-y-2"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
          >
            <label htmlFor="padre-paste-list" className="block text-small font-bold">
              Cole a lista de confirmados (WhatsApp):
            </label>
            <textarea
              id="padre-paste-list"
              rows="3"
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Ex: 1- Lucas, 2- Camila, Mariana confirmed, Gabriel..."
              className="w-full border rounded-xl p-2 text-sm outline-none"
              style={{
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-main)',
                borderColor: 'var(--border-color)',
              }}
            />
            <Button onClick={handleIdentifyPlayers} className="w-full">
              Identificar jogadores
            </Button>
          </div>

          {sessionPlayers.length > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between items-center px-1">
                <span className="font-bold text-small">Jogadores na mesa ({sessionPlayers.length})</span>
                <button
                  type="button"
                  onClick={() => setSessionPlayers([])}
                  className="min-h-11 text-small font-bold cursor-pointer"
                  style={{ color: 'var(--danger)' }}
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
            <label htmlFor="padre-quick-player" className="sr-only">
              Nome de outro jogador
            </label>
            <input
              id="padre-quick-player"
              type="text"
              value={newPlayerName}
              onChange={(e) => setNewPlayerName(e.target.value)}
              placeholder="Nome de outro jogador..."
              className="flex-1 min-h-11 border rounded-xl p-2 text-sm outline-none"
              style={{
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-main)',
                borderColor: 'var(--border-color)',
              }}
            />
            <Button type="submit" variant="secondary">
              Adicionar
            </Button>
          </form>

          <div
            className="p-4 rounded-2xl border space-y-3"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
          >
            <div>
              <p className="block text-caption font-bold mb-1" style={{ color: 'var(--text-muted)' }}>
                Formato do jogo
              </p>
              <div className="flex rounded-xl p-1 gap-1" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                {[2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setTeamSize(n)}
                    className="flex-1 min-h-11 text-small font-bold rounded-lg cursor-pointer"
                    style={{
                      backgroundColor: teamSize === n ? 'var(--primary)' : 'transparent',
                      color: teamSize === n ? 'var(--text-on-primary)' : 'var(--text-muted)',
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
                className="min-h-11 py-2 px-2 text-small font-bold rounded-xl border cursor-pointer"
                style={{
                  backgroundColor: balanceGender ? 'var(--bg-subtle)' : 'transparent',
                  borderColor: balanceGender ? 'var(--primary)' : 'var(--border-color)',
                }}
              >
                Gênero {balanceGender ? '✓' : ''}
              </button>
              <button
                type="button"
                onClick={() => setBalanceHeight(!balanceHeight)}
                className="min-h-11 py-2 px-2 text-small font-bold rounded-xl border cursor-pointer"
                style={{
                  backgroundColor: balanceHeight ? 'var(--bg-subtle)' : 'transparent',
                  borderColor: balanceHeight ? 'var(--primary)' : 'var(--border-color)',
                }}
              >
                Altura {balanceHeight ? '✓' : ''}
              </button>
            </div>
          </div>

          <Button variant="accent" onClick={runMonteCarloDraft} className="w-full text-base">
            Sortear times
          </Button>
        </div>
      )}

      {currentView === 'preview' && draftPreview && (
        <div className="space-y-4 pb-12">
          <h2 className="text-h1 text-center">Prévia do sorteio</h2>
          {draftPreview.teams.map((team, idx) => {
            const scoreSum = team.reduce((a, b) => a + b.score, 0);
            return (
              <div
                key={idx}
                className="border rounded-2xl overflow-hidden"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
              >
                <div
                  className="p-3 flex justify-between items-center border-b"
                  style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}
                >
                  <span className="font-bold">Time {idx + 1}</span>
                  <span
                    className="text-caption font-bold px-2 py-0.5 rounded"
                    style={{ backgroundColor: 'var(--primary)', color: 'var(--text-on-primary)' }}
                  >
                    Força: {scoreSum}
                  </span>
                </div>
                <div className="p-3 space-y-1">
                  {team.map((p) => (
                    <div
                      key={p.id}
                      className="flex justify-between text-small py-1 border-b last:border-0"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <span>
                        {p.name} ({p.gender === 'F' ? 'F' : 'M'} · {p.height === 'tall' ? 'Alto' : 'Baixo'})
                      </span>
                      <span className="font-bold" style={{ color: 'var(--accent)' }}>
                        {p.score}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="flex gap-2 pt-4">
            <Button variant="secondary" onClick={runMonteCarloDraft} className="flex-1">
              Refazer
            </Button>
            <Button onClick={handleConfirmDraft} className="flex-1">
              Confirmar
            </Button>
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

      {currentView === 'sessions' && auth.user && (
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

      {currentView === 'groups' && auth.user && (
        <Suspense fallback={<RouteFallback />}>
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
        </Suspense>
      )}

      {currentView === 'competitions' && auth.user && (
        <Suspense fallback={<RouteFallback />}>
          <CloudCompetitionsView
            configured={auth.configured}
            ready={auth.ready}
            user={auth.user}
            pendingCompetitionJoinCode={pendingCompetitionJoinCode}
            openCompetitionId={cloudCompetitionId}
            onOpenCompetition={setCloudCompetitionId}
          />
        </Suspense>
      )}

      {currentView === 'profile' && auth.user && (
        <div className="space-y-4">
          <h2 className="text-h1">Perfil</h2>
          <LegacyBrowserNotice visible={Boolean(foundLegacy)} onOpenMigration={openMigration} />
          <Suspense fallback={<RouteFallback />}>
            <CloudProfileView user={auth.user} onOpenPlayer={openPlayerProfile} />
          </Suspense>
        </div>
      )}

      {currentView === 'community' && auth.user && isCommunityBetaEnabled() && (
        <Suspense fallback={<RouteFallback />}>
          <CommunityView
            section={communitySection}
            onSection={(next) => {
              setCommunitySection(next);
              if (globalThis.location) globalThis.location.hash = communityHash(next);
            }}
            onOpenPlayer={openPlayerProfile}
          />
        </Suspense>
      )}

      {currentView === 'player' && auth.user && isCommunityBetaEnabled() && (
        <Suspense fallback={<RouteFallback />}>
          <PlayerProfileView
            playerId={playerProfileId}
            onBack={() => {
              setCurrentView('community');
              if (globalThis.location) globalThis.location.hash = communityHash(communitySection);
            }}
          />
        </Suspense>
      )}

      {currentView === 'migration' && (
        <Suspense fallback={<RouteFallback />}>
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
        </Suspense>
      )}

      {currentView === 'history' && draftHistory.length > 0 && (
        <div className="space-y-4">
          <div
            className="flex justify-between items-center p-2 rounded-2xl border"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
          >
            <button
              type="button"
              onClick={() => setCurrentDraftIndex(Math.min(currentDraftIndex + 1, draftHistory.length - 1))}
              disabled={currentDraftIndex === draftHistory.length - 1}
              className="min-h-11 p-2 font-bold cursor-pointer disabled:opacity-30"
              style={{ color: 'var(--primary)' }}
            >
              ← Anterior
            </button>
            <span className="text-caption" style={{ color: 'var(--text-muted)' }}>
              {draftHistory[currentDraftIndex].date}
            </span>
            <button
              type="button"
              onClick={() => setCurrentDraftIndex(Math.max(currentDraftIndex - 1, 0))}
              disabled={currentDraftIndex === 0}
              className="min-h-11 p-2 font-bold cursor-pointer"
              style={{ color: 'var(--primary)' }}
            >
              Próximo →
            </button>
          </div>
          {draftHistory[currentDraftIndex].teams.map((team, idx) => (
            <div
              key={idx}
              className="border rounded-2xl p-3 space-y-1"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
            >
              <h3 className="font-bold border-b pb-1" style={{ color: 'var(--primary)', borderColor: 'var(--border-color)' }}>
                Time {idx + 1}
              </h3>
              {team.map((p) => (
                <div key={p.id} className="flex justify-between text-small py-1">
                  <span>{p.name}</span>
                  <span style={{ color: 'var(--accent)' }}>{p.score}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
