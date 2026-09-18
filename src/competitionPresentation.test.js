import { describe, expect, it } from 'vitest';
import {
  applyCompetitionMatchResult,
  createDraftCompetition,
  generateCompetitionBracket,
  listCompetitionRounds,
  setDraftCompetitionTeams,
} from './domain/competition.js';
import {
  buildCompetitionBracketModel,
  canPlayCompetitionMatch,
  competitionChampionView,
  competitionListItem,
  competitionsForDisplay,
  currentCompetitionPhase,
  formatCompetitionDate,
  moveItemInList,
  parseCompetitionStructureInput,
  seedTeamIdsFromTeams,
  stagesFromStructure,
} from './competitionPresentation.js';

const ISO = '2026-09-18T18:00:00.000Z';
const NOW = () => new Date(ISO);

function sequentialIds(prefix = 'id') {
  let count = 0;
  return () => `${prefix}-${(count += 1)}`;
}

function membersFor(index) {
  return [
    { playerId: `p${index}a`, playerName: `Jogador ${index}A` },
    { playerId: `p${index}b`, playerName: `Jogador ${index}B` },
  ];
}

function teamsForCount(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `team-${index + 1}`,
    members: membersFor(index + 1),
  }));
}

function draftWithTeams(count) {
  const idGenerator = sequentialIds('c');
  const competition = createDraftCompetition(
    { name: `${count} times`, date: '2026-09-18', format: { teamSize: 2 } },
    { idGenerator, now: NOW }
  );
  return setDraftCompetitionTeams(competition, teamsForCount(count), { idGenerator }).competition;
}

function generate(count) {
  const idGenerator = sequentialIds(`b${count}`);
  return generateCompetitionBracket(draftWithTeams(count), { idGenerator }).competition;
}

function play(competition, matchId, scoreA, scoreB) {
  return applyCompetitionMatchResult(competition, matchId, {
    scoreA,
    scoreB,
    playedDate: '2026-09-18',
  }).competition;
}

describe('competitionPresentation', () => {
  it('ordena em andamento, rascunho e finalizadas, com data mais recente primeiro', () => {
    const finished = {
      ...generate(2),
      id: 'fin',
      status: 'finished',
      date: '2026-09-10',
      createdAt: '2026-09-10T00:00:00.000Z',
    };
    const draft = {
      ...createDraftCompetition({ name: 'Rascunho', date: '2026-09-18' }, { now: NOW, idGenerator: () => 'd1' }),
      status: 'draft',
    };
    const olderLive = { ...generate(2), id: 'old', status: 'in_progress', date: '2026-09-11' };
    const newerLive = { ...generate(2), id: 'new', status: 'in_progress', date: '2026-09-12' };

    expect(competitionsForDisplay([finished, draft, olderLive, newerLive]).map((item) => item.id)).toEqual([
      'new',
      'old',
      'd1',
      'fin',
    ]);
  });

  it('resume a lista com fase atual e campeão só quando existir', () => {
    const draft = createDraftCompetition(
      { name: 'Open', date: '2026-09-18', format: { teamSize: 2 } },
      { now: NOW, idGenerator: () => 'open' }
    );
    const item = competitionListItem(draft);
    expect(item).toMatchObject({
      name: 'Open',
      dateLabel: formatCompetitionDate(draft),
      formatLabel: '2x2',
      statusLabel: 'Rascunho',
      phaseLabel: 'Rascunho',
      championLabel: null,
    });
    expect(item.teamCountLabel).toContain('0');
  });

  it('mostra a fase pendente e não replica regra de chave', () => {
    const competition = generate(4);
    expect(currentCompetitionPhase(competition)).toBe('Eliminação simples · Semifinal');
    const [sf1, sf2] = listCompetitionRounds(competition)[0].matches;
    const afterOne = play(competition, sf1.id, 21, 15);
    expect(currentCompetitionPhase(afterOne)).toBe('Eliminação simples · Semifinal');
    const afterTwo = play(afterOne, sf2.id, 21, 18);
    expect(currentCompetitionPhase(afterTwo)).toBe('Eliminação simples · Final');
    expect(canPlayCompetitionMatch(listCompetitionRounds(afterTwo)[1].matches[0])).toBe(true);
    expect(canPlayCompetitionMatch(listCompetitionRounds(afterOne)[1].matches[0])).toBe(false);
  });

  it('monta colunas a partir das origens do domínio, com BYE na fase anterior', () => {
    const three = generate(3);
    const model = buildCompetitionBracketModel(three);
    expect(model.columns.map((column) => column.name)).toEqual(['Semifinal', 'Final']);
    expect(model.columns[0].slots.map((slot) => slot.type)).toEqual(['bye', 'match']);
    expect(model.columns[0].slots[0]).toMatchObject({
      type: 'bye',
      byeLabel: 'BYE',
      playable: false,
    });
    expect(model.columns[1].slots).toHaveLength(1);
    expect(model.columns[1].slots[0].playable).toBe(false);
    expect(model.columns[1].slots[0].leftId).toBe(model.columns[0].slots[0].id);
    expect(model.columns[1].slots[0].rightId).toBe(model.columns[0].slots[1].id);

    const four = generate(4);
    const fourModel = buildCompetitionBracketModel(four);
    expect(fourModel.columns.map((column) => column.name)).toEqual(['Semifinal', 'Final']);
    expect(fourModel.columns[0].slots.every((slot) => slot.type === 'match')).toBe(true);
    expect(fourModel.columns[0].slots.every((slot) => slot.playable)).toBe(true);
  });

  it('destaca o campeão com o placar da final', () => {
    const competition = generate(2);
    const final = listCompetitionRounds(competition)[0].matches[0];
    const finished = play(competition, final.id, 21, 18);
    const view = competitionChampionView(finished);
    expect(view).toMatchObject({
      heading: 'Campeão',
      teamLabel: 'Jogador 1A + Jogador 1B',
      scoreLabel: '21 × 18',
      finalRoundName: 'Final',
    });
    expect(competitionListItem(finished).championLabel).toBe('Jogador 1A + Jogador 1B');
  });

  it('reordena o seeding sem inventar algoritmo', () => {
    const teams = teamsForCount(3);
    expect(seedTeamIdsFromTeams(moveItemInList(teams, 0, 1))).toEqual(['team-2', 'team-1', 'team-3']);
    expect(seedTeamIdsFromTeams(moveItemInList(teams, 0, -1))).toEqual(['team-1', 'team-2', 'team-3']);
  });

  it('monta fases a partir da estrutura escolhida na UI', () => {
    expect(stagesFromStructure({ structure: 'swiss_then_double', roundCount: 4, grandFinalMode: 'single_final' })).toEqual([
      { type: 'swiss', config: { roundCount: 4 } },
      { type: 'double_elimination', config: { grandFinalMode: 'single_final' } },
    ]);
    expect(parseCompetitionStructureInput({ structure: 'swiss', roundCount: 0 }).ok).toBe(false);
    expect(parseCompetitionStructureInput({ structure: 'swiss', roundCount: 2 }).stages).toEqual([
      { type: 'swiss', config: { roundCount: 2 } },
    ]);
  });
});
