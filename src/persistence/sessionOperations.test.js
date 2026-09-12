import { describe, expect, it } from 'vitest';
import { GAME_SESSIONS_STORAGE_KEY, GIST_PENDING_CHANGES_STORAGE_KEY } from './constants.js';
import { createEmptyGameSessionsDocument } from './gameSessionsDocument.js';
import {
  applyGameSessionsOperation,
  INVALID_CACHE_CONFIRMATION_MESSAGE,
  INVALID_CACHE_CONFIRMATION_REQUIRED,
} from './sessionOperations.js';
import { persistLocalGameSessions } from './syncHelpers.js';
import { addSessionTeam, appendDraftTeamSession, updateTeamSessionDetails } from '../teamGameSessions.js';

const ISO = '2026-09-12T18:00:00.000Z';
const NOW = () => new Date(ISO);
const roster = [
  { id: 'p1', name: 'Erik' },
  { id: 'p2', name: 'André' },
];

function createMemoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
    snapshot() {
      return { ...data };
    },
  };
}

function createHarness({ document, storage, cacheInvalid = false, persist = persistLocalGameSessions }) {
  let current = document;
  let pending = false;
  const harness = {
    current: () => current,
    pending: () => pending,
    storage,
    apply(operation, { discardConfirmed = false } = {}) {
      return applyGameSessionsOperation({
        getDocument: () => current,
        setDocument: (next) => {
          current = next;
        },
        persistDocument: (next) => persist(next, storage),
        markPending: () => {
          pending = true;
        },
        operation,
        cacheInvalid,
        discardConfirmed,
      });
    },
  };
  return harness;
}

describe('applyGameSessionsOperation', () => {
  it('duas operações rápidas antes do re-render preservam as duas alterações', () => {
    const storage = createMemoryStorage({
      volleyPlayers: '[]',
      volleyDrafts: '[]',
    });
    const harness = createHarness({
      document: createEmptyGameSessionsDocument(),
      storage,
    });

    const first = harness.apply((document) => {
      const created = appendDraftTeamSession(
        document,
        { date: '2026-09-12', name: 'Primeiro' },
        { idGenerator: () => 'session-1', now: NOW }
      );
      return { ok: true, errors: [], document: created.document, session: created.session };
    });
    const second = harness.apply((document) =>
      addSessionTeam(document, 'session-1', ['p1', 'p2'], { roster, now: NOW })
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(harness.current().sessions).toHaveLength(1);
    expect(harness.current().sessions[0].name).toBe('Primeiro');
    expect(harness.current().sessions[0].teams).toHaveLength(1);
    expect(harness.current().sessions[0].teams[0].members.map((member) => member.playerId)).toEqual([
      'p1',
      'p2',
    ]);
    expect(harness.pending()).toBe(true);
    expect(storage.getItem('volleyPlayers')).toBe('[]');
    expect(storage.getItem('volleyDrafts')).toBe('[]');
  });

  it('cache corrompido + cancelar não altera estado, cache ou pendência', () => {
    const original = '{broken';
    const storage = createMemoryStorage({
      [GAME_SESSIONS_STORAGE_KEY]: original,
      volleyPlayers: '[{"id":"p1"}]',
      volleyDrafts: '[]',
    });
    const harness = createHarness({
      document: createEmptyGameSessionsDocument(),
      storage,
      cacheInvalid: true,
    });

    const result = harness.apply((document) => {
      const created = appendDraftTeamSession(
        document,
        { date: '2026-09-12', name: 'Novo' },
        { idGenerator: () => 'session-1', now: NOW }
      );
      return { ok: true, errors: [], document: created.document, session: created.session };
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe(INVALID_CACHE_CONFIRMATION_REQUIRED);
    expect(result.errors[0].message).toBe(INVALID_CACHE_CONFIRMATION_MESSAGE);
    expect(harness.current()).toEqual(createEmptyGameSessionsDocument());
    expect(harness.pending()).toBe(false);
    expect(storage.snapshot()).toEqual({
      [GAME_SESSIONS_STORAGE_KEY]: original,
      volleyPlayers: '[{"id":"p1"}]',
      volleyDrafts: '[]',
    });
  });

  it('cache corrompido + confirmar grava V2, limpa o erro e marca pendência', () => {
    const storage = createMemoryStorage({
      [GAME_SESSIONS_STORAGE_KEY]: '{broken',
      volleyPlayers: '[{"id":"p1"}]',
      volleyDrafts: '[]',
    });
    const harness = createHarness({
      document: createEmptyGameSessionsDocument(),
      storage,
      cacheInvalid: true,
    });

    const result = harness.apply(
      (document) => {
        const created = appendDraftTeamSession(
          document,
          { date: '2026-09-12', name: 'Recuperado' },
          { idGenerator: () => 'session-1', now: NOW }
        );
        return { ok: true, errors: [], document: created.document, session: created.session };
      },
      { discardConfirmed: true }
    );

    expect(result.ok).toBe(true);
    expect(result.persistOk).toBe(true);
    expect(result.cacheCleared).toBe(true);
    expect(harness.current().sessions[0].name).toBe('Recuperado');
    expect(harness.pending()).toBe(true);
    expect(JSON.parse(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).schemaVersion).toBe(2);
    expect(storage.getItem('volleyPlayers')).toBe('[{"id":"p1"}]');
    expect(storage.getItem('volleyDrafts')).toBe('[]');
    expect(storage.getItem(GIST_PENDING_CHANGES_STORAGE_KEY)).toBeNull();
  });

  it('falha após confirmação mantém a proteção e as outras chaves', () => {
    const original = '{broken';
    const storage = createMemoryStorage({
      [GAME_SESSIONS_STORAGE_KEY]: original,
      volleyPlayers: '[{"id":"p1"}]',
      volleyDrafts: '[{"id":"d1"}]',
    });
    let document = createEmptyGameSessionsDocument();
    let pending = false;

    const result = applyGameSessionsOperation({
      getDocument: () => document,
      setDocument: (next) => {
        document = next;
      },
      persistDocument: () => ({ ok: false, error: 'quota exceeded' }),
      markPending: () => {
        pending = true;
      },
      operation: (current) => {
        const created = appendDraftTeamSession(
          current,
          { date: '2026-09-12', name: 'Novo' },
          { idGenerator: () => 'session-1', now: NOW }
        );
        return { ok: true, errors: [], document: created.document, session: created.session };
      },
      cacheInvalid: true,
      discardConfirmed: true,
    });

    expect(result.ok).toBe(true);
    expect(result.persistOk).toBe(false);
    expect(result.persistError).toBe('quota exceeded');
    expect(result.cacheCleared).toBe(false);
    expect(document).toEqual(createEmptyGameSessionsDocument());
    expect(pending).toBe(false);
    expect(storage.snapshot()).toEqual({
      [GAME_SESSIONS_STORAGE_KEY]: original,
      volleyPlayers: '[{"id":"p1"}]',
      volleyDrafts: '[{"id":"d1"}]',
    });
  });

  it('edição sem mudança não grava cache nem marca pendência', () => {
    const storage = createMemoryStorage();
    const created = appendDraftTeamSession(
      createEmptyGameSessionsDocument(),
      { date: '2026-09-12', name: 'Arena' },
      { idGenerator: () => 'session-1', now: NOW }
    );
    const harness = createHarness({
      document: created.document,
      storage,
    });

    const result = harness.apply((document) =>
      updateTeamSessionDetails(document, 'session-1', {
        date: '2026-09-12',
        name: 'Arena',
        teamSize: 2,
        teamCount: 2,
      })
    );

    expect(result.ok).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(harness.pending()).toBe(false);
    expect(storage.getItem(GAME_SESSIONS_STORAGE_KEY)).toBeNull();
    expect(harness.current()).toBe(created.document);
  });
});
