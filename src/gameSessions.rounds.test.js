import { describe, expect, it } from 'vitest';
import { GAME_SESSIONS_SCHEMA_VERSION } from './persistence/constants.js';
import { countSessionMatches, validateSessionPairs } from './domain/sessionValidation.js';
import {
  addSessionPair,
  canEditSessionPairs,
  canGenerateSessionRounds,
  resetSessionToDraftForPairEditing,
  startSessionRoundRobin,
} from './gameSessions.js';

const NOW = () => new Date('2026-09-12T19:00:00.000Z');
const LATER = () => new Date('2026-09-12T20:00:00.000Z');
const ISO_CREATED = '2026-09-12T18:00:00.000Z';
const ISO_UPDATED = '2026-09-12T19:00:00.000Z';

const roster = [
  { id: 'p1', name: 'Erik' },
  { id: 'p2', name: 'André' },
  { id: 'p3', name: 'Gabi' },
  { id: 'p4', name: 'Luiza' },
  { id: 'p5', name: 'Ana' },
  { id: 'p6', name: 'Paulo' },
  { id: 'p7', name: 'Ian' },
  { id: 'p8', name: 'BH' },
];

function pair(id, first, second) {
  return {
    id,
    members: [
      { playerId: first.id, playerName: first.name },
      { playerId: second.id, playerName: second.name },
    ],
  };
}

const twoPairs = [
  pair('pair-1', roster[0], roster[1]),
  pair('pair-2', roster[2], roster[3]),
];

const threePairs = [...twoPairs, pair('pair-3', roster[4], roster[5])];
const fourPairs = [...threePairs, pair('pair-4', roster[6], roster[7])];

function draftSession(overrides = {}) {
  return {
    id: 'session-1',
    date: '2026-09-12',
    name: 'Arena',
    status: 'draft',
    createdAt: ISO_CREATED,
    updatedAt: ISO_CREATED,
    pairs: twoPairs,
    rounds: [],
    ...overrides,
  };
}

function documentWith(session, extraSessions = []) {
  return {
    schemaVersion: GAME_SESSIONS_SCHEMA_VERSION,
    sessions: [session, ...extraSessions],
  };
}

function sequentialIds(prefix = 'id') {
  let count = 0;
  return () => `${prefix}-${(count += 1)}`;
}

function allMatches(rounds) {
  return (rounds ?? []).flatMap((round) => round.matches ?? []);
}

describe('startSessionRoundRobin', () => {
  it('gera uma rodada e uma partida a partir de duas duplas', () => {
    const original = documentWith(draftSession());
    const result = startSessionRoundRobin(original, 'session-1', {
      roster,
      idGenerator: sequentialIds(),
      now: NOW,
      generateConfirmed: true,
    });

    expect(result.ok).toBe(true);
    expect(result.session.rounds).toHaveLength(1);
    expect(allMatches(result.session.rounds)).toHaveLength(1);
    expect(result.session.rounds[0].byePairId).toBeNull();
    expect(countSessionMatches(result.session)).toEqual({
      total: 1,
      completed: 0,
      pending: 1,
      invalid: 0,
    });
  });

  it('gera três rodadas, três partidas e uma folga por dupla a partir de três duplas', () => {
    const result = startSessionRoundRobin(documentWith(draftSession({ pairs: threePairs })), 'session-1', {
      roster,
      idGenerator: sequentialIds(),
      now: NOW,
      generateConfirmed: true,
    });

    expect(result.ok).toBe(true);
    expect(result.session.rounds).toHaveLength(3);
    expect(allMatches(result.session.rounds)).toHaveLength(3);
    expect(result.session.rounds.map((round) => round.byePairId).sort()).toEqual([
      'pair-1',
      'pair-2',
      'pair-3',
    ]);
  });

  it('gera três rodadas e seis partidas a partir de quatro duplas', () => {
    const result = startSessionRoundRobin(documentWith(draftSession({ pairs: fourPairs })), 'session-1', {
      roster,
      idGenerator: sequentialIds(),
      now: NOW,
      generateConfirmed: true,
    });

    expect(result.ok).toBe(true);
    expect(result.session.rounds).toHaveLength(3);
    expect(allMatches(result.session.rounds)).toHaveLength(6);
    expect(result.session.rounds.every((round) => round.byePairId === null)).toBe(true);
  });

  it('inicia todas as partidas com placar nulo', () => {
    const result = startSessionRoundRobin(documentWith(draftSession({ pairs: fourPairs })), 'session-1', {
      roster,
      idGenerator: sequentialIds(),
      now: NOW,
      generateConfirmed: true,
    });

    for (const match of allMatches(result.session.rounds)) {
      expect(match.scoreA).toBeNull();
      expect(match.scoreB).toBeNull();
    }
  });

  it('muda o encontro de draft para in_progress preservando duplas e createdAt', () => {
    const other = draftSession({ id: 'session-2', name: 'Outro', pairs: [] });
    const originalPairs = twoPairs;
    const original = documentWith(draftSession({ pairs: originalPairs }), [other]);

    const result = startSessionRoundRobin(original, 'session-1', {
      roster,
      idGenerator: sequentialIds(),
      now: NOW,
      generateConfirmed: true,
    });

    expect(result.session.status).toBe('in_progress');
    expect(result.session.pairs).toEqual(originalPairs);
    expect(result.session.id).toBe('session-1');
    expect(result.session.date).toBe('2026-09-12');
    expect(result.session.name).toBe('Arena');
    expect(result.session.createdAt).toBe(ISO_CREATED);
    expect(result.session.updatedAt).toBe(ISO_UPDATED);
    expect(result.document.schemaVersion).toBe(GAME_SESSIONS_SCHEMA_VERSION);
    expect(result.document.sessions[1]).toEqual(other);
    expect(canEditSessionPairs(result.session)).toBe(false);
    expect(validateSessionPairs(result.session.pairs, roster).ok).toBe(true);
  });

  it('cancela sem alteração quando a confirmação é exigida', () => {
    const original = documentWith(draftSession());
    const result = startSessionRoundRobin(original, 'session-1', {
      roster,
      now: NOW,
      generateConfirmed: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('GENERATE_ROUNDS_CONFIRMATION_REQUIRED');
    expect(result.document).toBeNull();
    expect(original.sessions[0].status).toBe('draft');
    expect(original.sessions[0].rounds).toEqual([]);
    expect(original.sessions[0].updatedAt).toBe(ISO_CREATED);
  });

  it('rejeita encontro inexistente', () => {
    const original = documentWith(draftSession());
    const result = startSessionRoundRobin(original, 'missing', {
      roster,
      generateConfirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('SESSION_NOT_FOUND');
    expect(original.sessions[0].rounds).toEqual([]);
  });

  it('rejeita menos de duas duplas', () => {
    const original = documentWith(draftSession({ pairs: [twoPairs[0]] }));
    const result = startSessionRoundRobin(original, 'session-1', {
      roster,
      generateConfirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('TOO_FEW_PAIRS');
    expect(result.errors[0].message).toBe('Forme pelo menos duas duplas para gerar os jogos.');
    expect(canGenerateSessionRounds(original.sessions[0], roster)).toBe(false);
  });

  it('rejeita duplas inválidas', () => {
    const original = documentWith(
      draftSession({
        pairs: [
          twoPairs[0],
          {
            id: 'pair-bad',
            members: [
              { playerId: 'missing', playerName: 'Fantasma' },
              { playerId: 'p3', playerName: 'Gabi' },
            ],
          },
        ],
      })
    );
    const result = startSessionRoundRobin(original, 'session-1', {
      roster,
      generateConfirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('PAIR_PLAYER_NOT_FOUND');
    expect(original.sessions[0].status).toBe('draft');
  });

  it('rejeita rodadas já existentes', () => {
    const original = documentWith(
      draftSession({
        rounds: [{ id: 'round-1', number: 1, byePairId: null, matches: [] }],
      })
    );
    const result = startSessionRoundRobin(original, 'session-1', {
      roster,
      generateConfirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('ROUNDS_ALREADY_EXIST');
  });

  it('rejeita status diferente de draft', () => {
    const original = documentWith(draftSession({ status: 'in_progress' }));
    const result = startSessionRoundRobin(original, 'session-1', {
      roster,
      generateConfirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('SESSION_NOT_DRAFT');
  });

  it('rejeita idGenerator inválido ou duplicado sem alteração parcial', () => {
    const original = documentWith(draftSession());
    const notAFunction = startSessionRoundRobin(original, 'session-1', {
      roster,
      idGenerator: 'nope',
      generateConfirmed: true,
    });
    expect(notAFunction.ok).toBe(false);
    expect(notAFunction.errors[0].code).toBe('ROUND_ROBIN_FAILED');
    expect(original.sessions[0].status).toBe('draft');
    expect(original.sessions[0].rounds).toEqual([]);

    const duplicate = startSessionRoundRobin(original, 'session-1', {
      roster,
      idGenerator: () => 'same',
      generateConfirmed: true,
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.errors[0].code).toBe('ROUND_ROBIN_FAILED');
    expect(duplicate.document).toBeNull();
    expect(original.sessions[0].updatedAt).toBe(ISO_CREATED);
  });

  it('não muta a entrada', () => {
    const original = documentWith(draftSession());
    const snapshot = JSON.parse(JSON.stringify(original));
    startSessionRoundRobin(original, 'session-1', {
      roster,
      idGenerator: sequentialIds(),
      now: NOW,
      generateConfirmed: true,
    });
    expect(original).toEqual(snapshot);
  });

  it('impede alteração de duplas depois de gerar as rodadas', () => {
    const started = startSessionRoundRobin(documentWith(draftSession()), 'session-1', {
      roster,
      idGenerator: sequentialIds(),
      now: NOW,
      generateConfirmed: true,
    });
    const locked = addSessionPair(
      started.document,
      'session-1',
      { playerA: roster[4], playerB: roster[5] },
      roster,
      { idGenerator: () => 'pair-new', now: LATER }
    );
    expect(locked.ok).toBe(false);
    expect(locked.errors[0].code).toBe('PAIRS_LOCKED');
    expect(started.document.sessions[0].pairs).toHaveLength(2);
  });
});

describe('resetSessionToDraftForPairEditing', () => {
  function inProgressSession(overrides = {}) {
    return draftSession({
      status: 'in_progress',
      updatedAt: ISO_UPDATED,
      rounds: [
        {
          id: 'round-1',
          number: 1,
          byePairId: null,
          matches: [
            {
              id: 'match-1',
              pairAId: 'pair-1',
              pairBId: 'pair-2',
              scoreA: 21,
              scoreB: 18,
            },
          ],
        },
      ],
      ...overrides,
    });
  }

  it('remove rodadas e placares, preserva duplas e volta para draft', () => {
    const other = draftSession({ id: 'session-2', name: 'Outro', pairs: [] });
    const original = documentWith(inProgressSession(), [other]);
    const originalPairs = original.sessions[0].pairs;

    const result = resetSessionToDraftForPairEditing(original, 'session-1', {
      now: LATER,
      resetConfirmed: true,
    });

    expect(result.ok).toBe(true);
    expect(result.session.status).toBe('draft');
    expect(result.session.rounds).toEqual([]);
    expect(result.session.pairs).toEqual(originalPairs);
    expect(result.session.createdAt).toBe(ISO_CREATED);
    expect(result.session.updatedAt).toBe('2026-09-12T20:00:00.000Z');
    expect(result.document.schemaVersion).toBe(GAME_SESSIONS_SCHEMA_VERSION);
    expect(result.document.sessions[1]).toEqual(other);
    expect(canEditSessionPairs(result.session)).toBe(true);
    expect(countSessionMatches(result.session).total).toBe(0);
  });

  it('cancela sem alteração quando a confirmação é exigida', () => {
    const original = documentWith(inProgressSession());
    const result = resetSessionToDraftForPairEditing(original, 'session-1', {
      now: LATER,
      resetConfirmed: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('RESET_TO_DRAFT_CONFIRMATION_REQUIRED');
    expect(result.errors[0].message).toBe(
      'Alterar as duplas apagará todas as rodadas e placares deste encontro. Deseja continuar?'
    );
    expect(original.sessions[0].status).toBe('in_progress');
    expect(original.sessions[0].rounds).toHaveLength(1);
    expect(original.sessions[0].rounds[0].matches[0].scoreA).toBe(21);
    expect(original.sessions[0].updatedAt).toBe(ISO_UPDATED);
  });

  it('rejeita encontro finalizado', () => {
    const original = documentWith(inProgressSession({ status: 'finished' }));
    const result = resetSessionToDraftForPairEditing(original, 'session-1', {
      now: LATER,
      resetConfirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('SESSION_FINISHED');
    expect(original.sessions[0].rounds).toHaveLength(1);
  });

  it('rejeita encontro inexistente', () => {
    const original = documentWith(inProgressSession());
    const result = resetSessionToDraftForPairEditing(original, 'missing', { resetConfirmed: true });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('SESSION_NOT_FOUND');
  });

  it('não muta a entrada', () => {
    const original = documentWith(inProgressSession());
    const snapshot = JSON.parse(JSON.stringify(original));
    resetSessionToDraftForPairEditing(original, 'session-1', {
      now: LATER,
      resetConfirmed: true,
    });
    expect(original).toEqual(snapshot);
  });
});
