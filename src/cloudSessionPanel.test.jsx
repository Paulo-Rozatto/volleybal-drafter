import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CloudSessionOpenPanel } from './CloudSessionsView.jsx';
import {
  createdCloudSessionId,
  fetchOpenCloudSession,
  shouldApplySessionLoad,
} from './cloudSessionPanel.js';
import { mapCloudSession } from './supabase/mappers.js';
import {
  canEditSessionTeams,
  sessionDisplayName,
  sessionListStats,
  teamSessionRoundSummary,
} from './teamGameSessions.js';

const emptyDraftPayload = {
  myUserId: 'owner-1',
  session: {
    id: '667d0098-60e4-4f3b-8a4b-3094c76e6b51',
    created_by: 'owner-1',
    name: 'Teste Supabase',
    date: '2026-09-21',
    status: 'draft',
    join_code: 'AB23CD56',
    team_size: 2,
    team_count: 2,
    structure_version: 0,
    created_at: '2026-09-21T16:00:00.000Z',
    updated_at: '2026-09-21T16:00:00.000Z',
  },
  members: [
    {
      session_id: '667d0098-60e4-4f3b-8a4b-3094c76e6b51',
      user_id: 'owner-1',
      role: 'owner',
      profiles: { id: 'owner-1', display_name: 'André' },
    },
  ],
  teams: [],
  rounds: [],
  matches: [],
  sessionPlayers: [],
  matchEvents: [],
};

describe('mapCloudSession encontro recém-criado', () => {
  it('carrega draft sem teams/rounds/matches/session_players', () => {
    const session = mapCloudSession(emptyDraftPayload);
    expect(session).toMatchObject({
      id: '667d0098-60e4-4f3b-8a4b-3094c76e6b51',
      name: 'Teste Supabase',
      status: 'draft',
      myRole: 'owner',
      teams: [],
      rounds: [],
      players: [],
      matchEvents: [],
    });
    expect(sessionDisplayName(session)).toBe('Teste Supabase');
    expect(sessionListStats(session)).toEqual({ teamCount: 0, matchCount: 0 });
    expect(teamSessionRoundSummary(session).roundCount).toBe(0);
    expect(canEditSessionTeams(session)).toBe(true);
  });

  it('não quebra se o PostgREST devolver relações nulas em vez de arrays', () => {
    const session = mapCloudSession({
      ...emptyDraftPayload,
      members: null,
      teams: null,
      rounds: null,
      matches: null,
      sessionPlayers: null,
      matchEvents: null,
    });
    expect(session.teams).toEqual([]);
    expect(session.rounds).toEqual([]);
    expect(session.members).toEqual([]);
    expect(session.myRole).toBeNull();
  });
});

describe('fetchOpenCloudSession', () => {
  it('propaga erro de loadCloudSession sem fingir loading', async () => {
    const loaded = await fetchOpenCloudSession(
      async () => ({ ok: false, session: null, error: { message: 'Encontro não encontrado.' } }),
      's1',
      'u1'
    );
    expect(loaded).toEqual({
      ok: false,
      session: null,
      error: 'Encontro não encontrado.',
    });
  });

  it('captura Promise rejection inesperada', async () => {
    const loaded = await fetchOpenCloudSession(
      async () => {
        throw new Error('boom mapper');
      },
      's1',
      'u1'
    );
    expect(loaded.ok).toBe(false);
    expect(loaded.session).toBeNull();
    expect(loaded.error).toBe('boom mapper');
  });

  it('devolve a session correta para o id pedido', async () => {
    const loaded = await fetchOpenCloudSession(
      async (sessionId) => ({
        ok: true,
        session: mapCloudSession({
          ...emptyDraftPayload,
          session: { ...emptyDraftPayload.session, id: sessionId, name: sessionId },
        }),
      }),
      'session-b',
      'owner-1'
    );
    expect(loaded.ok).toBe(true);
    expect(loaded.session.id).toBe('session-b');
    expect(loaded.session.name).toBe('session-b');
  });
});

describe('create -> open', () => {
  it('abre o id devolvido por createCloudSession', () => {
    const opened = [];
    const created = {
      ok: true,
      session: { id: '667d0098-60e4-4f3b-8a4b-3094c76e6b51', name: 'Teste Supabase' },
    };
    const sessionId = createdCloudSessionId(created);
    expect(sessionId).toBe('667d0098-60e4-4f3b-8a4b-3094c76e6b51');
    opened.push(sessionId);
    expect(opened).toEqual(['667d0098-60e4-4f3b-8a4b-3094c76e6b51']);
    expect(createdCloudSessionId({ ok: true, session: {} })).toBeNull();
  });

  it('ignora resposta atrasada de outro encontro', () => {
    expect(shouldApplySessionLoad('old', 'new')).toBe(false);
    expect(shouldApplySessionLoad('new', 'new')).toBe(true);
  });
});

describe('CloudSessionOpenPanel', () => {
  const user = { id: 'owner-1' };

  it('mostra loading só com sessionLoading', () => {
    const html = renderToStaticMarkup(
      <CloudSessionOpenPanel
        sessionLoading
        sessionError={null}
        session={null}
        user={user}
        onBack={vi.fn()}
        onRetry={vi.fn()}
        onReload={vi.fn()}
      />
    );
    expect(html).toContain('Carregando encontro...');
    expect(html).not.toContain('Recarregar');
  });

  it('mostra erro de loadCloudSession e não deixa loading infinito', () => {
    const html = renderToStaticMarkup(
      <CloudSessionOpenPanel
        sessionLoading={false}
        sessionError="Encontro não encontrado."
        session={null}
        user={user}
        onBack={vi.fn()}
        onRetry={vi.fn()}
        onReload={vi.fn()}
      />
    );
    expect(html).toContain('Encontro não encontrado.');
    expect(html).toContain('Recarregar');
    expect(html).not.toContain('Carregando encontro...');
  });

  it('mostra erro também quando a Promise rejeita (mensagem já capturada)', () => {
    const html = renderToStaticMarkup(
      <CloudSessionOpenPanel
        sessionLoading={false}
        sessionError="boom mapper"
        session={null}
        user={user}
        onBack={vi.fn()}
        onRetry={vi.fn()}
        onReload={vi.fn()}
      />
    );
    expect(html).toContain('boom mapper');
    expect(html).not.toContain('Carregando encontro...');
  });

  it('renderiza encontro recém-criado vazio', () => {
    const session = mapCloudSession(emptyDraftPayload);
    const html = renderToStaticMarkup(
      <CloudSessionOpenPanel
        sessionLoading={false}
        sessionError={null}
        session={session}
        user={user}
        onBack={vi.fn()}
        onRetry={vi.fn()}
        onReload={vi.fn()}
      />
    );
    expect(html).toContain('Teste Supabase');
    expect(html).toContain('Rascunho');
    expect(html).not.toContain('Carregando encontro...');
  });
});
