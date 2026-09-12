import { describe, expect, it } from 'vitest';
import { countSessionMatches } from './domain/sessionValidation.js';
import {
  clearSessionMatchScore,
  sessionIsReadyToFinalize,
  setSessionMatchScore,
} from './gameSessions.js';

const NOW = () => new Date('2026-09-12T19:00:00.000Z');
const LATER = () => new Date('2026-09-12T20:00:00.000Z');
const ISO_CREATED = '2026-09-12T18:00:00.000Z';
const ISO_UPDATED = '2026-09-12T19:00:00.000Z';

const pairs = [
  {
    id: 'pair-1',
    members: [
      { playerId: 'p1', playerName: 'Erik' },
      { playerId: 'p2', playerName: 'André' },
    ],
  },
  {
    id: 'pair-2',
    members: [
      { playerId: 'p3', playerName: 'Gabi' },
      { playerId: 'p4', playerName: 'Luiza' },
    ],
  },
];

function match(id, scoreA, scoreB, pairAId = 'pair-1', pairBId = 'pair-2') {
  return { id, pairAId, pairBId, scoreA, scoreB };
}

function inProgressSession(overrides = {}) {
  return {
    id: 'session-1',
    date: '2026-09-12',
    name: 'Arena',
    status: 'in_progress',
    createdAt: ISO_CREATED,
    updatedAt: ISO_CREATED,
    pairs,
    rounds: [
      {
        id: 'round-1',
        number: 1,
        byePairId: null,
        matches: [match('match-1', null, null), match('match-2', 15, 10)],
      },
      {
        id: 'round-2',
        number: 2,
        byePairId: null,
        matches: [match('match-3', null, null)],
      },
    ],
    ...overrides,
  };
}

function documentWith(session, extraSessions = []) {
  return {
    schemaVersion: 1,
    sessions: [session, ...extraSessions],
  };
}

describe('setSessionMatchScore', () => {
  it('salva 21 × 18 e 0 × 1', () => {
    const first = setSessionMatchScore(documentWith(inProgressSession()), 'session-1', 'round-1', 'match-1', 21, 18, {
      now: NOW,
    });
    expect(first.ok).toBe(true);
    expect(first.session.rounds[0].matches[0]).toMatchObject({ scoreA: 21, scoreB: 18 });
    expect(first.session.status).toBe('in_progress');

    const zero = setSessionMatchScore(first.document, 'session-1', 'round-2', 'match-3', 0, 1, {
      now: LATER,
    });
    expect(zero.session.rounds[1].matches[0]).toMatchObject({ scoreA: 0, scoreB: 1 });
  });

  it('edita um placar existente', () => {
    const original = documentWith(inProgressSession());
    const result = setSessionMatchScore(original, 'session-1', 'round-1', 'match-2', 21, 19, { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.session.rounds[0].matches[1]).toMatchObject({ scoreA: 21, scoreB: 19 });
    expect(original.sessions[0].rounds[0].matches[1]).toMatchObject({ scoreA: 15, scoreB: 10 });
  });

  it('rejeita empate, negativo, decimal, parcial e não numérico', () => {
    const original = documentWith(inProgressSession());
    expect(
      setSessionMatchScore(original, 'session-1', 'round-1', 'match-1', 21, 21, { now: NOW }).errors[0].code
    ).toBe('SCORE_TIE');
    expect(
      setSessionMatchScore(original, 'session-1', 'round-1', 'match-1', -1, 18, { now: NOW }).errors[0].code
    ).toBe('SCORE_NEGATIVE');
    expect(
      setSessionMatchScore(original, 'session-1', 'round-1', 'match-1', 21.5, 18, { now: NOW }).errors[0].code
    ).toBe('SCORE_NOT_INTEGER');
    expect(
      setSessionMatchScore(original, 'session-1', 'round-1', 'match-1', 21, null, { now: NOW }).errors[0].code
    ).toBe('SCORE_PARTIAL');
    expect(
      setSessionMatchScore(original, 'session-1', 'round-1', 'match-1', null, null, { now: NOW }).errors[0].code
    ).toBe('SCORE_PARTIAL');
    expect(
      setSessionMatchScore(original, 'session-1', 'round-1', 'match-1', '21', 18, { now: NOW }).errors[0].code
    ).toBe('SCORE_INVALID_TYPE');
    expect(original.sessions[0].rounds[0].matches[0]).toMatchObject({ scoreA: null, scoreB: null });
  });

  it('rejeita draft, finished, encontro, rodada e partida inválidos', () => {
    expect(
      setSessionMatchScore(documentWith(inProgressSession({ status: 'draft' })), 'session-1', 'round-1', 'match-1', 21, 18)
        .errors[0].code
    ).toBe('SESSION_NOT_IN_PROGRESS');
    expect(
      setSessionMatchScore(
        documentWith(inProgressSession({ status: 'finished' })),
        'session-1',
        'round-1',
        'match-1',
        21,
        18
      ).errors[0].code
    ).toBe('SESSION_FINISHED');
    expect(
      setSessionMatchScore(documentWith(inProgressSession()), 'missing', 'round-1', 'match-1', 21, 18).errors[0]
        .code
    ).toBe('SESSION_NOT_FOUND');
    expect(
      setSessionMatchScore(documentWith(inProgressSession()), 'session-1', 'missing-round', 'match-1', 21, 18)
        .errors[0].code
    ).toBe('ROUND_NOT_FOUND');
    expect(
      setSessionMatchScore(documentWith(inProgressSession()), 'session-1', 'round-1', 'missing-match', 21, 18)
        .errors[0].code
    ).toBe('MATCH_NOT_FOUND');
  });

  it('preserva demais partidas, rodadas, duplas, sessões, schema e createdAt', () => {
    const other = inProgressSession({ id: 'session-2', name: 'Outro', pairs: [], rounds: [] });
    const original = documentWith(inProgressSession(), [other]);
    const result = setSessionMatchScore(original, 'session-1', 'round-1', 'match-1', 21, 18, { now: NOW });

    expect(result.session.rounds[0].matches[1]).toMatchObject({ scoreA: 15, scoreB: 10 });
    expect(result.session.rounds[1].matches[0]).toMatchObject({ scoreA: null, scoreB: null });
    expect(result.session.pairs).toEqual(pairs);
    expect(result.session.createdAt).toBe(ISO_CREATED);
    expect(result.session.updatedAt).toBe(ISO_UPDATED);
    expect(result.session.status).toBe('in_progress');
    expect(result.document.schemaVersion).toBe(1);
    expect(result.document.sessions[1]).toEqual(other);
  });

  it('não muta a entrada', () => {
    const original = documentWith(inProgressSession());
    const snapshot = JSON.parse(JSON.stringify(original));
    setSessionMatchScore(original, 'session-1', 'round-1', 'match-1', 21, 18, { now: NOW });
    expect(original).toEqual(snapshot);
  });
});

describe('clearSessionMatchScore', () => {
  it('volta placar preenchido para null/null e marca a partida como pendente', () => {
    const original = documentWith(inProgressSession());
    const result = clearSessionMatchScore(original, 'session-1', 'round-1', 'match-2', {
      now: NOW,
      clearConfirmed: true,
    });

    expect(result.ok).toBe(true);
    expect(result.session.rounds[0].matches[1]).toMatchObject({ scoreA: null, scoreB: null });
    expect(countSessionMatches(result.session).pending).toBe(3);
    expect(result.session.updatedAt).toBe(ISO_UPDATED);
    expect(result.session.status).toBe('in_progress');
    expect(original.sessions[0].rounds[0].matches[1]).toMatchObject({ scoreA: 15, scoreB: 10 });
  });

  it('define o comportamento de limpar partida já pendente', () => {
    const original = documentWith(inProgressSession());
    const result = clearSessionMatchScore(original, 'session-1', 'round-1', 'match-1', {
      now: NOW,
      clearConfirmed: true,
    });

    expect(result.ok).toBe(true);
    expect(result.session.rounds[0].matches[0]).toMatchObject({ scoreA: null, scoreB: null });
    expect(result.session.updatedAt).toBe(ISO_UPDATED);
    expect(countSessionMatches(result.session).pending).toBe(2);
  });

  it('cancela sem alteração quando a confirmação é exigida', () => {
    const original = documentWith(inProgressSession());
    const result = clearSessionMatchScore(original, 'session-1', 'round-1', 'match-2', {
      now: NOW,
      clearConfirmed: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('CLEAR_SCORE_CONFIRMATION_REQUIRED');
    expect(result.document).toBeNull();
    expect(original.sessions[0].rounds[0].matches[1]).toMatchObject({ scoreA: 15, scoreB: 10 });
    expect(original.sessions[0].updatedAt).toBe(ISO_CREATED);
  });

  it('rejeita estados e IDs inválidos', () => {
    expect(
      clearSessionMatchScore(documentWith(inProgressSession({ status: 'draft' })), 'session-1', 'round-1', 'match-2', {
        clearConfirmed: true,
      }).errors[0].code
    ).toBe('SESSION_NOT_IN_PROGRESS');
    expect(
      clearSessionMatchScore(
        documentWith(inProgressSession({ status: 'finished' })),
        'session-1',
        'round-1',
        'match-2',
        { clearConfirmed: true }
      ).errors[0].code
    ).toBe('SESSION_FINISHED');
    expect(
      clearSessionMatchScore(documentWith(inProgressSession()), 'missing', 'round-1', 'match-2', {
        clearConfirmed: true,
      }).errors[0].code
    ).toBe('SESSION_NOT_FOUND');
    expect(
      clearSessionMatchScore(documentWith(inProgressSession()), 'session-1', 'missing', 'match-2', {
        clearConfirmed: true,
      }).errors[0].code
    ).toBe('ROUND_NOT_FOUND');
    expect(
      clearSessionMatchScore(documentWith(inProgressSession()), 'session-1', 'round-1', 'missing', {
        clearConfirmed: true,
      }).errors[0].code
    ).toBe('MATCH_NOT_FOUND');
  });

  it('não muta a entrada', () => {
    const original = documentWith(inProgressSession());
    const snapshot = JSON.parse(JSON.stringify(original));
    clearSessionMatchScore(original, 'session-1', 'round-1', 'match-2', {
      now: NOW,
      clearConfirmed: true,
    });
    expect(original).toEqual(snapshot);
  });
});

describe('sessionIsReadyToFinalize', () => {
  it('não aparece com partidas pendentes', () => {
    expect(sessionIsReadyToFinalize(inProgressSession())).toBe(false);
  });

  it('aparece quando todas estão concluídas', () => {
    const session = inProgressSession({
      rounds: [
        {
          id: 'round-1',
          number: 1,
          byePairId: null,
          matches: [match('match-1', 21, 18), match('match-2', 15, 10), match('match-3', 0, 1)],
        },
      ],
    });
    expect(countSessionMatches(session)).toMatchObject({ total: 3, completed: 3, pending: 0, invalid: 0 });
    expect(sessionIsReadyToFinalize(session)).toBe(true);
  });

  it('não aparece com partida inválida', () => {
    const session = inProgressSession({
      rounds: [
        {
          id: 'round-1',
          number: 1,
          byePairId: null,
          matches: [match('match-1', 21, 18), match('match-2', 15, 15)],
        },
      ],
    });
    expect(countSessionMatches(session).invalid).toBe(1);
    expect(sessionIsReadyToFinalize(session)).toBe(false);
  });

  it('desaparece depois de limpar um placar', () => {
    const complete = inProgressSession({
      rounds: [
        {
          id: 'round-1',
          number: 1,
          byePairId: null,
          matches: [match('match-1', 21, 18), match('match-2', 15, 10)],
        },
      ],
    });
    expect(sessionIsReadyToFinalize(complete)).toBe(true);

    const cleared = clearSessionMatchScore(documentWith(complete), 'session-1', 'round-1', 'match-1', {
      now: NOW,
      clearConfirmed: true,
    });
    expect(sessionIsReadyToFinalize(cleared.session)).toBe(false);
    expect(countSessionMatches(cleared.session).pending).toBe(1);
  });
});
