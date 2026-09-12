import { describe, expect, it } from 'vitest';
import {
  formatPairLabel,
  formatMatchScore,
  matchWinningSide,
  MISSING_PAIR_LABEL,
  resolveByeLabel,
  resolvePairLabel,
  roundsInOrder,
} from './roundDisplay.js';

const pairs = [
  {
    id: 'pair-1',
    members: [
      { playerId: 'p1', playerName: 'Gabi' },
      { playerId: 'p2', playerName: 'Wellington' },
    ],
  },
  {
    id: 'pair-2',
    members: [
      { playerId: 'p3', playerName: '  Luiza  ' },
      { playerId: 'p4', playerName: 'Arthur' },
    ],
  },
];

describe('formatPairLabel', () => {
  it('usa os nomes históricos da dupla', () => {
    expect(formatPairLabel(pairs[0])).toBe('Gabi + Wellington');
  });

  it('indica dupla ausente sem quebrar', () => {
    expect(formatPairLabel(null)).toBe(MISSING_PAIR_LABEL);
    expect(formatPairLabel({ members: [] })).toBe(MISSING_PAIR_LABEL);
  });
});

describe('resolvePairLabel', () => {
  it('resolve a dupla pelo ID armazenado no encontro', () => {
    expect(resolvePairLabel(pairs, 'pair-2')).toBe('Luiza + Arthur');
  });

  it('não consulta o elenco atual e trata referência inválida', () => {
    expect(resolvePairLabel(pairs, 'missing')).toBe(MISSING_PAIR_LABEL);
    expect(resolvePairLabel(pairs, '')).toBe(MISSING_PAIR_LABEL);
    expect(resolvePairLabel(pairs, null)).toBe(MISSING_PAIR_LABEL);
  });
});

describe('resolveByeLabel', () => {
  it('omite folga quando byePairId é nulo', () => {
    expect(resolveByeLabel(pairs, null)).toBeNull();
  });

  it('mostra a dupla de folga ou uma indicação segura', () => {
    expect(resolveByeLabel(pairs, 'pair-1')).toBe('Gabi + Wellington');
    expect(resolveByeLabel(pairs, 'gone')).toBe(MISSING_PAIR_LABEL);
  });
});

describe('roundsInOrder', () => {
  it('ordena rodadas pelo número sem mutar a entrada', () => {
    const rounds = [
      { id: 'r2', number: 2 },
      { id: 'r1', number: 1 },
    ];
    const snapshot = [...rounds];
    expect(roundsInOrder(rounds).map((round) => round.id)).toEqual(['r1', 'r2']);
    expect(rounds).toEqual(snapshot);
  });
});

describe('formatMatchScore e matchWinningSide', () => {
  it('mostra placar pendente e concluído sem gravar vencedor', () => {
    const pending = { scoreA: null, scoreB: null };
    const completed = { scoreA: 21, scoreB: 18 };
    expect(formatMatchScore(pending)).toBe('— × —');
    expect(formatMatchScore(completed)).toBe('21 × 18');
    expect(matchWinningSide(pending)).toBeNull();
    expect(matchWinningSide(completed)).toBe('A');
    expect(matchWinningSide({ scoreA: 10, scoreB: 21 })).toBe('B');
    expect(completed).not.toHaveProperty('winner');
  });
});
