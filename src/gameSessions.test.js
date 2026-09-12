import { describe, expect, it } from 'vitest';
import { GAME_SESSIONS_SCHEMA_VERSION } from './persistence/constants.js';
import {
  appendDraftGameSession,
  createDraftGameSession,
  localDateString,
  sessionsForDisplay,
} from './gameSessions.js';

const NOW = () => new Date('2026-09-12T18:30:00.000Z');
const ISO_NOW = '2026-09-12T18:30:00.000Z';

describe('localDateString', () => {
  it('usa o calendário local e não desloca o dia por UTC', () => {
    expect(localDateString(new Date(2026, 8, 12, 23, 30, 0))).toBe('2026-09-12');
    expect(localDateString(new Date(2026, 8, 12, 0, 0, 0))).toBe('2026-09-12');
  });
});

describe('createDraftGameSession', () => {
  it('cria um encontro com todos os campos esperados', () => {
    const session = createDraftGameSession(
      { date: '2026-09-12', name: 'Sábado na Arena' },
      { idGenerator: () => 'session-1', now: NOW }
    );

    expect(session).toEqual({
      id: 'session-1',
      date: '2026-09-12',
      name: 'Sábado na Arena',
      status: 'draft',
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
      pairs: [],
      rounds: [],
    });
    expect(Object.keys(session)).toEqual([
      'id',
      'date',
      'name',
      'status',
      'createdAt',
      'updatedAt',
      'pairs',
      'rounds',
    ]);
  });

  it('define o status inicial como draft', () => {
    const session = createDraftGameSession(
      { date: '2026-09-12' },
      { idGenerator: () => 'session-1', now: NOW }
    );
    expect(session.status).toBe('draft');
  });

  it('apara o nome', () => {
    const session = createDraftGameSession(
      { date: '2026-09-12', name: '  Sábado na Arena  ' },
      { idGenerator: () => 'session-1', now: NOW }
    );
    expect(session.name).toBe('Sábado na Arena');
  });

  it('converte nome vazio para null', () => {
    const unnamed = createDraftGameSession(
      { date: '2026-09-12', name: '   ' },
      { idGenerator: () => 'session-1', now: NOW }
    );
    const missing = createDraftGameSession(
      { date: '2026-09-12' },
      { idGenerator: () => 'session-2', now: NOW }
    );

    expect(unnamed.name).toBeNull();
    expect(missing.name).toBeNull();
  });

  it('rejeita data inválida', () => {
    expect(() =>
      createDraftGameSession({ date: '2026-02-30' }, { idGenerator: () => 'session-1', now: NOW })
    ).toThrow('A data informada não existe.');
    expect(() =>
      createDraftGameSession({ date: '12/09/2026' }, { idGenerator: () => 'session-1', now: NOW })
    ).toThrow('A data deve estar no formato YYYY-MM-DD.');
    expect(() =>
      createDraftGameSession({ date: '' }, { idGenerator: () => 'session-1', now: NOW })
    ).toThrow('A data do encontro é obrigatória.');
  });

  it('aceita idGenerator e relógio injetáveis', () => {
    const session = createDraftGameSession(
      { date: '2026-09-13', name: 'Teste' },
      { idGenerator: () => 'injected-id', now: () => new Date('2026-01-02T03:04:05.000Z') }
    );

    expect(session.id).toBe('injected-id');
    expect(session.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(session.updatedAt).toBe(session.createdAt);
  });

  it('não muta a entrada original', () => {
    const input = { date: '2026-09-12', name: '  Arena  ' };
    const snapshot = { ...input };
    createDraftGameSession(input, { idGenerator: () => 'session-1', now: NOW });
    expect(input).toEqual(snapshot);
  });
});

describe('appendDraftGameSession', () => {
  it('preserva schemaVersion e os encontros anteriores', () => {
    const previous = {
      id: 'old-1',
      date: '2026-09-01',
      name: 'Anterior',
      status: 'finished',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
      pairs: [{ id: 'pair-1' }],
      rounds: [{ id: 'round-1', matches: [] }],
    };
    const original = {
      schemaVersion: GAME_SESSIONS_SCHEMA_VERSION,
      sessions: [previous],
    };

    const { document, session } = appendDraftGameSession(
      original,
      { date: '2026-09-12', name: 'Novo' },
      { idGenerator: () => 'session-2', now: NOW }
    );

    expect(document.schemaVersion).toBe(GAME_SESSIONS_SCHEMA_VERSION);
    expect(document.sessions).toEqual([previous, session]);
    expect(document.sessions[0]).toBe(previous);
    expect(session.id).toBe('session-2');
  });

  it('não muta o documento original', () => {
    const original = {
      schemaVersion: GAME_SESSIONS_SCHEMA_VERSION,
      sessions: [{ id: 'old-1' }],
    };
    const originalSessions = original.sessions;

    appendDraftGameSession(
      original,
      { date: '2026-09-12' },
      { idGenerator: () => 'session-2', now: NOW }
    );

    expect(original.sessions).toBe(originalSessions);
    expect(original.sessions).toEqual([{ id: 'old-1' }]);
  });

  it('rejeita data inválida sem alterar o documento', () => {
    const original = {
      schemaVersion: GAME_SESSIONS_SCHEMA_VERSION,
      sessions: [{ id: 'old-1' }],
    };

    expect(() =>
      appendDraftGameSession(original, { date: '2026-13-01' }, { idGenerator: () => 'x', now: NOW })
    ).toThrow('A data informada não existe.');
    expect(original.sessions).toEqual([{ id: 'old-1' }]);
  });
});

describe('sessionsForDisplay', () => {
  it('ordena só a cópia, do mais recente para o mais antigo', () => {
    const sessions = [
      { id: 'a', date: '2026-09-01', createdAt: '2026-09-01T10:00:00.000Z' },
      { id: 'b', date: '2026-09-12', createdAt: '2026-09-10T10:00:00.000Z' },
      { id: 'c', date: '2026-09-12', createdAt: '2026-09-11T10:00:00.000Z' },
    ];

    expect(sessionsForDisplay(sessions).map((item) => item.id)).toEqual(['c', 'b', 'a']);
    expect(sessions.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});
