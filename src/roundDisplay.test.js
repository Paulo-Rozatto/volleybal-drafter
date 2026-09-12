import { describe, expect, it } from 'vitest';
import {
  formatTeamLabel,
  formatMatchScore,
  matchWinningSide,
  MISSING_TEAM_LABEL,
  resolveByeLabel,
  resolveMatchSideLabel,
  resolveTeamLabel,
  roundsInOrder,
} from './roundDisplay.js';

const teams = [
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

describe('formatTeamLabel', () => {
  it('usa os nomes históricos do time', () => {
    expect(formatTeamLabel(teams[0])).toBe('Gabi + Wellington');
  });

  it('indica time ausente sem quebrar', () => {
    expect(formatTeamLabel(null)).toBe(MISSING_TEAM_LABEL);
    expect(formatTeamLabel({ members: [] })).toBe(MISSING_TEAM_LABEL);
  });

  it('usa índice e lineup nos formatos maiores', () => {
    const six = {
      id: 'team-6',
      members: [
        { playerId: 'p1', playerName: 'Ana' },
        { playerId: 'p2', playerName: 'André' },
        { playerId: 'p3', playerName: 'Luiza' },
      ],
    };
    expect(formatTeamLabel(six, { teamSize: 6, index: 0 })).toBe('Time 1: Ana, André, Luiza');
    expect(formatTeamLabel({ members: [] }, { teamSize: 6, index: 2 })).toBe(
      'Time 3: Sem jogadores'
    );
    expect(resolveTeamLabel([six], 'missing', { teamSize: 6 })).toBe('Time não encontrado');
  });
});

describe('resolveTeamLabel', () => {
  it('resolve o time pelo ID armazenado no encontro', () => {
    expect(resolveTeamLabel(teams, 'pair-2')).toBe('Luiza + Arthur');
  });

  it('não consulta o elenco atual e trata referência inválida', () => {
    expect(resolveTeamLabel(teams, 'missing')).toBe(MISSING_TEAM_LABEL);
    expect(resolveTeamLabel(teams, '')).toBe(MISSING_TEAM_LABEL);
    expect(resolveTeamLabel(teams, null)).toBe(MISSING_TEAM_LABEL);
  });
});

describe('resolveByeLabel', () => {
  it('omite folga quando byeTeamId é nulo', () => {
    expect(resolveByeLabel(teams, null)).toBeNull();
  });

  it('mostra o time de folga ou uma indicação segura', () => {
    expect(resolveByeLabel(teams, 'pair-1')).toBe('Gabi + Wellington');
    expect(resolveByeLabel(teams, 'gone')).toBe(MISSING_TEAM_LABEL);
  });

  it('usa a lineup da partida no placar', () => {
    const match = {
      teamAId: 'pair-1',
      teamBId: 'pair-2',
      lineupA: teams[0].members,
      lineupB: [{ playerId: 'p3', playerName: 'Luiza' }],
    };
    expect(resolveMatchSideLabel(match, 'A', teams, 2)).toBe('Gabi + Wellington');
    expect(resolveMatchSideLabel(match, 'B', teams, 2)).toBe('Luiza');
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
