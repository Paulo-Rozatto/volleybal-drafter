import { describe, expect, it } from 'vitest';
import {
  SESSION_FORMAT_OPTIONS,
  addTeamActionLabel,
  alterTeamsLabel,
  drawTeamsLabel,
  formatDoublesNames,
  formatFormatLabel,
  formatIndexedTeamNames,
  formatLineupLoanLabel,
  formatLineupMemberLabel,
  formatMatchLineupCount,
  formatMatchSideLabel,
  formatSessionTeamLabel,
  formatTeamCountPhrase,
  formedTeamsHeading,
  generateRoundsConfirmationMessage,
  allTeamsFormedMessage,
  missingTeamLabel,
  resetToDraftConfirmationMessage,
  selectedCountLabel,
  teamUnitNoun,
  teamUnitPlural,
  teamUnitSingular,
  usesDoublesLabels,
} from './teamPresentation.js';

describe('terminologia de formato', () => {
  it('usa Dupla/Duplas no 2x2 e Time/Times nos demais', () => {
    expect(teamUnitSingular(2)).toBe('dupla');
    expect(teamUnitPlural(2)).toBe('duplas');
    expect(teamUnitNoun(2, 1)).toBe('dupla');
    expect(teamUnitNoun(2, 3)).toBe('duplas');
    for (const teamSize of [3, 4, 5, 6]) {
      expect(teamUnitSingular(teamSize)).toBe('time');
      expect(teamUnitPlural(teamSize)).toBe('times');
      expect(teamUnitNoun(teamSize, 1)).toBe('time');
      expect(teamUnitNoun(teamSize, 4)).toBe('times');
    }
  });

  it('expõe os cinco formatos e detecta rótulos de dupla', () => {
    expect(SESSION_FORMAT_OPTIONS.map((item) => item.label)).toEqual([
      '2x2',
      '3x3',
      '4x4',
      '5x5',
      '6x6',
    ]);
    expect(usesDoublesLabels({ format: { teamSize: 2 } })).toBe(true);
    expect(usesDoublesLabels({ format: { teamSize: 6 } })).toBe(false);
    expect(usesDoublesLabels(2)).toBe(true);
    expect(formatFormatLabel(4)).toBe('4x4');
    expect(formatTeamCountPhrase(1, 2)).toBe('1 dupla');
    expect(formatTeamCountPhrase(3, 2)).toBe('3 duplas');
    expect(formatTeamCountPhrase(3, 6)).toBe('3 times');
  });

  it('ajusta títulos e confirmações sem gravar rótulos no documento', () => {
    expect(formedTeamsHeading(1, 2, 2)).toBe('Duplas formadas (1/2)');
    expect(formedTeamsHeading(2, 3, 6)).toBe('Times formados (2/3)');
    expect(allTeamsFormedMessage(3, 3, 6)).toBe('Todos os times já foram formados (3/3).');
    expect(allTeamsFormedMessage(2, 2, 2)).toBe('Todas as duplas já foram formadas (2/2).');
    expect(addTeamActionLabel(2, false)).toBe('Adicionar dupla');
    expect(addTeamActionLabel(6, false)).toBe('Adicionar time');
    expect(addTeamActionLabel(3, true)).toBe('Salvar alteração');
    expect(alterTeamsLabel(2)).toBe('Alterar duplas');
    expect(alterTeamsLabel(5)).toBe('Alterar times');
    expect(drawTeamsLabel(2)).toBe('Sortear duplas');
    expect(drawTeamsLabel(4)).toBe('Sortear times');
    expect(formatMatchLineupCount('A', 5, 6)).toBe('Time A: 5/6');
    expect(formatMatchLineupCount('B', 2, 2)).toBe('Dupla B: 2/2');
    expect(formatLineupLoanLabel('Luiza', 2, 6)).toBe('Luiza — empréstimo do Time 3');
    expect(formatLineupLoanLabel('Erik', 1, 2)).toBe('Erik — empréstimo da Dupla 2');
    expect(
      formatLineupMemberLabel(
        { playerId: 'p3', playerName: 'Luiza' },
        [
          { id: 't1', members: [{ playerId: 'p1', playerName: 'Ana' }] },
          { id: 't2', members: [{ playerId: 'p2', playerName: 'André' }] },
          { id: 't3', members: [{ playerId: 'p3', playerName: 'Luiza' }] },
        ],
        't1',
        6
      )
    ).toBe('Luiza — empréstimo do Time 3');
    expect(
      formatLineupMemberLabel(
        { playerId: 'p1', playerName: 'Ana' },
        [{ id: 't1', members: [{ playerId: 'p1', playerName: 'Ana' }] }],
        't1',
        6
      )
    ).toBe('Ana');
    expect(generateRoundsConfirmationMessage(2)).toMatch(/duplas/);
    expect(generateRoundsConfirmationMessage(6)).toMatch(/times/);
    expect(resetToDraftConfirmationMessage(2)).toMatch(/duplas/);
    expect(resetToDraftConfirmationMessage(3)).toMatch(/times/);
    expect(missingTeamLabel(2)).toBe('Dupla não encontrada');
    expect(missingTeamLabel(6)).toBe('Time não encontrado');
    expect(selectedCountLabel(4, 6)).toBe('Selecionados: 4 de até 6');
  });
});

describe('labels de times', () => {
  const team = {
    id: 't1',
    members: [
      { playerId: 'p1', playerName: 'Ana' },
      { playerId: 'p2', playerName: 'André' },
      { playerId: 'p3', playerName: 'Luiza' },
    ],
  };

  it('preserva a apresentação 2x2 pelos dois nomes', () => {
    expect(formatDoublesNames(['Gabi', 'Wellington'])).toBe('Gabi + Wellington');
    expect(
      formatSessionTeamLabel(
        {
          members: [
            { playerId: 'p1', playerName: 'Gabi' },
            { playerId: 'p2', playerName: 'Wellington' },
          ],
        },
        { teamSize: 2, index: 0 }
      )
    ).toBe('Gabi + Wellington');
  });

  it('lista vários integrantes e time vazio nos formatos maiores', () => {
    expect(formatIndexedTeamNames(['Ana', 'André', 'Luiza'], 0)).toBe('Time 1: Ana, André, Luiza');
    expect(formatIndexedTeamNames(['Arthur', 'Paulo'], 1)).toBe('Time 2: Arthur, Paulo');
    expect(formatIndexedTeamNames([], 2)).toBe('Time 3: Sem jogadores');
    expect(formatSessionTeamLabel(team, { teamSize: 6, index: 0 })).toBe(
      'Time 1: Ana, André, Luiza'
    );
    expect(formatSessionTeamLabel({ members: [] }, { teamSize: 6, index: 2 })).toBe(
      'Time 3: Sem jogadores'
    );
  });

  it('usa a lineup da partida e não muta a entrada', () => {
    const teams = [team, { id: 't2', members: [{ playerId: 'p4', playerName: 'Arthur' }] }];
    const snapshot = JSON.parse(JSON.stringify(teams));
    const match = {
      teamAId: 't1',
      teamBId: 't2',
      lineupA: [
        { playerId: 'p1', playerName: 'Ana' },
        { playerId: 'p2', playerName: 'André' },
      ],
      lineupB: [{ playerId: 'p4', playerName: 'Arthur' }],
    };

    expect(formatMatchSideLabel({ lineup: match.lineupA, teams, teamId: 't1', teamSize: 6 })).toBe(
      'Time 1: Ana, André'
    );
    expect(formatMatchSideLabel({ lineup: match.lineupB, teams, teamId: 't2', teamSize: 6 })).toBe(
      'Time 2: Arthur'
    );
    expect(
      formatMatchSideLabel({
        lineup: [
          { playerId: 'p1', playerName: 'Gabi' },
          { playerId: 'p2', playerName: 'Wellington' },
        ],
        teams,
        teamId: 't1',
        teamSize: 2,
      })
    ).toBe('Gabi + Wellington');
    expect(teams).toEqual(snapshot);
  });
});
