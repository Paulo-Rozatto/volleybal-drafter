import { describe, expect, it } from 'vitest';
import {
  calcTeamBalancePenalty,
  GENDER_PENALTY_WEIGHT,
  HEIGHT_PENALTY_WEIGHT,
  prepareTeamDraftPool,
  SCORE_PENALTY_WEIGHT,
} from './teamBalance.js';

const teamA = [
  { id: 'a1', score: 5, gender: 'F', height: 'tall' },
  { id: 'a2', score: 5, gender: 'F', height: 'tall' },
];
const teamB = [
  { id: 'b1', score: 1, gender: 'M', height: 'short' },
  { id: 'b2', score: 1, gender: 'M', height: 'short' },
];

describe('calcTeamBalancePenalty', () => {
  it('penaliza diferença de score com peso 4', () => {
    const penalty = calcTeamBalancePenalty([teamA, teamB], {
      balanceGender: false,
      balanceHeight: false,
    });
    // scores 10 e 2, média 6, variância 32, * 4 = 128
    expect(SCORE_PENALTY_WEIGHT).toBe(4);
    expect(penalty).toBe(128);
  });

  it('inclui gênero só quando habilitado', () => {
    const withoutGender = calcTeamBalancePenalty([teamA, teamB], {
      balanceGender: false,
      balanceHeight: false,
    });
    const withGender = calcTeamBalancePenalty([teamA, teamB], {
      balanceGender: true,
      balanceHeight: false,
    });
    expect(GENDER_PENALTY_WEIGHT).toBe(3);
    expect(withGender).toBeGreaterThan(withoutGender);
    expect(withGender - withoutGender).toBe(6);
  });

  it('inclui altura só quando habilitada', () => {
    const withoutHeight = calcTeamBalancePenalty([teamA, teamB], {
      balanceGender: false,
      balanceHeight: false,
    });
    const withHeight = calcTeamBalancePenalty([teamA, teamB], {
      balanceGender: false,
      balanceHeight: true,
    });
    expect(HEIGHT_PENALTY_WEIGHT).toBe(3);
    expect(withHeight).toBeGreaterThan(withoutHeight);
    expect(withHeight - withoutHeight).toBe(6);
  });

  it('não muta as entradas', () => {
    const teams = [teamA, teamB];
    const snapshot = JSON.parse(JSON.stringify(teams));
    calcTeamBalancePenalty(teams, { balanceGender: true, balanceHeight: true });
    expect(teams).toEqual(snapshot);
  });

  it('mantém os pesos existentes de score, gênero e altura', () => {
    const neither = calcTeamBalancePenalty([teamA, teamB], {
      balanceGender: false,
      balanceHeight: false,
    });
    const both = calcTeamBalancePenalty([teamA, teamB]);
    expect(neither).toBe(128);
    expect(both).toBe(140);
  });
});

describe('prepareTeamDraftPool', () => {
  const players = [
    { id: '1', score: 5 },
    { id: '2', score: 4 },
    { id: '3', score: 3 },
    { id: '4', score: 3 },
    { id: '5', score: 2 },
    { id: '6', score: 2 },
    { id: '7', score: 1 },
    { id: '8', score: 1 },
  ];

  it('permite formatos maiores que 2x2', () => {
    const pool = prepareTeamDraftPool(players, 3);
    expect(pool.numTeams).toBe(2);
    expect(pool.playersToDraft).toHaveLength(6);

    const twelve = [
      ...players,
      { id: '9', score: 1 },
      { id: '10', score: 1 },
      { id: '11', score: 1 },
      { id: '12', score: 1 },
    ];
    const sixes = prepareTeamDraftPool(twelve, 6);
    expect(sixes.numTeams).toBe(2);
    expect(sixes.playersToDraft).toHaveLength(12);
    expect(sixes.bench).toHaveLength(0);
  });

  it('mantém jogadores excedentes no banco', () => {
    const pool = prepareTeamDraftPool(players, 3);
    expect(pool.bench).toHaveLength(2);
    expect(pool.bench.map((player) => player.id)).toEqual(['7', '8']);
    expect(players).toHaveLength(8);
  });

  it('não muta a lista recebida', () => {
    const snapshot = [...players];
    prepareTeamDraftPool(players, 6);
    expect(players).toEqual(snapshot);
  });
});
