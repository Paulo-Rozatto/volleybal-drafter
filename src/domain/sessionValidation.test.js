import { describe, expect, it } from 'vitest';
import {
  canFinalizeSession,
  countSessionMatches,
  isMatchCompleted,
  isMatchPending,
  validateCanFinalize,
  validateDate,
  validatePair,
  validateScore,
  validateSessionPairs,
  sessionIsReadyToFinalize,
} from './sessionValidation.js';

const roster = [
  { id: 'p1', name: 'Erik' },
  { id: 'p2', name: 'André' },
  { id: 'p3', name: 'Gabi' },
  { id: 'p4', name: 'Luiza' },
];

function makePair(id, playerAId, playerBId, names = ['Erik', 'André']) {
  return {
    id,
    members: [
      { playerId: playerAId, playerName: names[0] },
      { playerId: playerBId, playerName: names[1] },
    ],
  };
}

function sessionFromScores(scores) {
  return {
    rounds: [
      {
        id: 'round-1',
        number: 1,
        byePairId: null,
        matches: scores.map((score, index) => ({
          id: `match-${index + 1}`,
          pairAId: 'pair-a',
          pairBId: 'pair-b',
          scoreA: score[0],
          scoreB: score[1],
        })),
      },
    ],
  };
}

describe('validateDate', () => {
  it('aceita uma data real no formato estrito', () => {
    expect(validateDate('2026-09-12').ok).toBe(true);
    expect(validateDate('2024-02-29').ok).toBe(true);
  });

  it('rejeita data ausente', () => {
    expect(validateDate(null).errors[0].code).toBe('DATE_REQUIRED');
    expect(validateDate(undefined).errors[0].code).toBe('DATE_REQUIRED');
    expect(validateDate('').errors[0].code).toBe('DATE_REQUIRED');
  });

  it('rejeita formato incorreto', () => {
    expect(validateDate('12/09/2026').errors[0].code).toBe('DATE_FORMAT');
    expect(validateDate('2026-9-12').errors[0].code).toBe('DATE_FORMAT');
    expect(validateDate('2026/09/12').errors[0].code).toBe('DATE_FORMAT');
    expect(validateDate('2026-09-12T00:00:00Z').errors[0].code).toBe('DATE_FORMAT');
  });

  it('rejeita data inexistente', () => {
    expect(validateDate('2026-02-30').errors[0].code).toBe('DATE_INVALID');
    expect(validateDate('2026-13-01').errors[0].code).toBe('DATE_INVALID');
    expect(validateDate('2025-02-29').errors[0].code).toBe('DATE_INVALID');
    expect(validateDate('2026-04-31').errors[0].code).toBe('DATE_INVALID');
  });
});

describe('validatePair', () => {
  it('aceita uma dupla válida', () => {
    const result = validatePair(makePair('d1', 'p1', 'p2'), roster);
    expect(result.ok).toBe(true);
  });

  it('rejeita dupla com jogador repetido', () => {
    const result = validatePair(makePair('d1', 'p1', 'p1', ['Erik', 'Erik']), roster);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === 'PAIR_DUPLICATE_PLAYER')).toBe(true);
  });

  it('rejeita jogador inexistente no elenco', () => {
    const result = validatePair(makePair('d1', 'p1', 'missing', ['Erik', 'Ghost']), roster);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === 'PAIR_PLAYER_NOT_FOUND')).toBe(true);
  });

  it('rejeita snapshot com nome vazio', () => {
    const result = validatePair(makePair('d1', 'p1', 'p2', ['Erik', '   ']), roster);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === 'PAIR_NAME_EMPTY')).toBe(true);
  });

  it('rejeita dupla que não tem exatamente dois integrantes', () => {
    const result = validatePair({ id: 'd1', members: [{ playerId: 'p1', playerName: 'Erik' }] }, roster);
    expect(result.errors[0].code).toBe('PAIR_MEMBERS_COUNT');
  });

  it('rejeita dupla sem ID', () => {
    const result = validatePair(
      { members: [{ playerId: 'p1', playerName: 'Erik' }, { playerId: 'p2', playerName: 'André' }] },
      roster
    );
    expect(result.errors.some((error) => error.code === 'PAIR_ID_INVALID')).toBe(true);
  });

  it('rejeita ID de dupla vazio', () => {
    const result = validatePair(makePair('', 'p1', 'p2'), roster);
    expect(result.errors.some((error) => error.code === 'PAIR_ID_INVALID')).toBe(true);
  });

  it('rejeita ID de dupla contendo somente espaços', () => {
    const result = validatePair(makePair('   ', 'p1', 'p2'), roster);
    expect(result.errors.some((error) => error.code === 'PAIR_ID_INVALID')).toBe(true);
  });

  it('rejeita playerId contendo somente espaços', () => {
    const result = validatePair(makePair('d1', '   ', 'p2', ['Erik', 'André']), roster);
    expect(result.errors.some((error) => error.code === 'PAIR_PLAYER_ID_INVALID')).toBe(true);
  });
});

describe('validateSessionPairs', () => {
  it('rejeita o mesmo jogador em duplas diferentes', () => {
    const result = validateSessionPairs(
      [makePair('d1', 'p1', 'p2'), makePair('d2', 'p1', 'p3', ['Erik', 'Gabi'])],
      roster
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === 'PAIR_PLAYER_ALREADY_PAIRED')).toBe(true);
  });

  it('aceita duplas sem jogadores repetidos', () => {
    const result = validateSessionPairs(
      [makePair('d1', 'p1', 'p2'), makePair('d2', 'p3', 'p4', ['Gabi', 'Luiza'])],
      roster
    );
    expect(result.ok).toBe(true);
  });

  it('rejeita duas duplas com o mesmo ID', () => {
    const result = validateSessionPairs(
      [makePair('d1', 'p1', 'p2'), makePair('d1', 'p3', 'p4', ['Gabi', 'Luiza'])],
      roster
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === 'PAIR_ID_DUPLICATE')).toBe(true);
  });
});

describe('validateScore', () => {
  it('aceita placar pendente', () => {
    expect(validateScore(null, null).ok).toBe(true);
  });

  it('aceita placar válido', () => {
    expect(validateScore(21, 18).ok).toBe(true);
    expect(validateScore(0, 1).ok).toBe(true);
  });

  it('rejeita placar parcial', () => {
    expect(validateScore(21, null).errors[0].code).toBe('SCORE_PARTIAL');
    expect(validateScore(null, 18).errors[0].code).toBe('SCORE_PARTIAL');
  });

  it('rejeita empate', () => {
    expect(validateScore(21, 21).errors[0].code).toBe('SCORE_TIE');
    expect(validateScore(0, 0).errors[0].code).toBe('SCORE_TIE');
  });

  it('rejeita placar negativo', () => {
    expect(validateScore(-1, 18).errors[0].code).toBe('SCORE_NEGATIVE');
    expect(validateScore(21, -4).errors[0].code).toBe('SCORE_NEGATIVE');
  });

  it('rejeita decimal', () => {
    expect(validateScore(21.5, 18).errors[0].code).toBe('SCORE_NOT_INTEGER');
    expect(validateScore(21, 18.1).errors[0].code).toBe('SCORE_NOT_INTEGER');
  });

  it('rejeita string', () => {
    expect(validateScore('21', 18).errors[0].code).toBe('SCORE_INVALID_TYPE');
    expect(validateScore(21, '18').errors[0].code).toBe('SCORE_INVALID_TYPE');
  });

  it('rejeita NaN e indefinido', () => {
    expect(validateScore(Number.NaN, 18).errors[0].code).toBe('SCORE_INVALID_TYPE');
    expect(validateScore(undefined, 18).errors[0].code).toBe('SCORE_INVALID_TYPE');
    expect(validateScore(undefined, undefined).ok).toBe(false);
  });
});

describe('estado das partidas e finalização', () => {
  it('identifica partida pendente e concluída', () => {
    expect(isMatchPending({ scoreA: null, scoreB: null })).toBe(true);
    expect(isMatchCompleted({ scoreA: null, scoreB: null })).toBe(false);
    expect(isMatchCompleted({ scoreA: 21, scoreB: 18 })).toBe(true);
    expect(isMatchCompleted({ scoreA: 21, scoreB: 21 })).toBe(false);
  });

  it('conta partidas concluídas e pendentes', () => {
    const counts = countSessionMatches(
      sessionFromScores([
        [21, 18],
        [null, null],
        [15, 21],
      ])
    );
    expect(counts).toEqual({
      total: 3,
      completed: 2,
      pending: 1,
      invalid: 0,
    });
  });

  it('separa partidas concluídas, pendentes e inválidas', () => {
    const counts = countSessionMatches(
      sessionFromScores([
        [21, 18],
        [null, null],
        [21, 21],
        [21, null],
      ])
    );
    expect(counts).toEqual({
      total: 4,
      completed: 1,
      pending: 1,
      invalid: 2,
    });
  });

  it('não permite finalizar encontro com partidas pendentes', () => {
    const session = sessionFromScores([
      [21, 18],
      [null, null],
    ]);
    expect(canFinalizeSession(session)).toBe(false);
    expect(validateCanFinalize(session).errors[0].code).toBe('FINALIZE_INCOMPLETE');
  });

  it('permite finalizar encontro com todas as partidas concluídas', () => {
    const session = sessionFromScores([
      [21, 18],
      [15, 21],
    ]);
    expect(canFinalizeSession(session)).toBe(true);
    expect(validateCanFinalize(session).ok).toBe(true);
  });

  it('não permite finalizar encontro sem nenhuma partida', () => {
    expect(canFinalizeSession({ rounds: [] })).toBe(false);
    expect(canFinalizeSession({ rounds: [{ matches: [] }] })).toBe(false);
    expect(validateCanFinalize({ rounds: [] }).errors[0].code).toBe('FINALIZE_NO_MATCHES');
  });

  it('não permite finalizar encontro com placar inválido', () => {
    const session = sessionFromScores([
      [21, 18],
      [21, 21],
    ]);
    expect(canFinalizeSession(session)).toBe(false);
    expect(validateCanFinalize(session).errors[0].code).toBe('FINALIZE_INCOMPLETE');
  });

  it('sessionIsReadyToFinalize exige todas as partidas válidas e concluídas', () => {
    expect(sessionIsReadyToFinalize(sessionFromScores([[21, 18], [15, 21]]))).toBe(true);
    expect(sessionIsReadyToFinalize(sessionFromScores([[21, 18], [null, null]]))).toBe(false);
    expect(sessionIsReadyToFinalize({ rounds: [] })).toBe(false);
  });
});
