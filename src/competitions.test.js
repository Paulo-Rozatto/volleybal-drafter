import { describe, expect, it } from 'vitest';
import {
  COMPETITION_DOWNSTREAM_CONFIRMATION_REQUIRED,
  addCompetitionTeam,
  appendDraftCompetition,
  clearCompetitionMatchScore,
  generateCompetitionBracket,
  getCompetitionChampion,
  moveCompetitionTeam,
  replaceCompetitionTeams,
  setCompetitionMatchScore,
} from './competitions.js';
import {
  createEmptyCompetitionDocument,
  getFinalMatch,
  listCompetitionMatches,
  listCompetitionRounds,
} from './domain/competition.js';

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

function seededDocument(count, prefix = 'doc') {
  const ids = sequentialIds(prefix);
  const created = appendDraftCompetition(
    createEmptyCompetitionDocument(),
    { name: 'Torneio', format: { teamSize: 2 } },
    { idGenerator: ids, now: NOW }
  );
  const withTeams = replaceCompetitionTeams(
    created.document,
    created.competition.id,
    teamsForCount(count),
    { idGenerator: ids, now: NOW }
  );
  const generated = generateCompetitionBracket(withTeams.document, created.competition.id, {
    idGenerator: ids,
    now: NOW,
  });
  return {
    document: generated.document,
    competition: generated.competition,
    ids,
  };
}

describe('operações de documento de competições', () => {
  it('acumula competições no documento sem mutar o original', () => {
    const empty = createEmptyCompetitionDocument();
    const first = appendDraftCompetition(empty, { name: 'A' }, { idGenerator: sequentialIds('a'), now: NOW });
    const second = appendDraftCompetition(first.document, { name: 'B' }, { idGenerator: sequentialIds('b'), now: NOW });
    expect(empty.competitions).toHaveLength(0);
    expect(first.document.competitions).toHaveLength(1);
    expect(second.document.competitions.map((item) => item.name)).toEqual(['A', 'B']);
  });

  it('registra resultados no documento e finaliza a competição', () => {
    const { document, competition } = seededDocument(2);
    const matchId = listCompetitionMatches(competition)[0].id;
    const scored = setCompetitionMatchScore(
      document,
      competition.id,
      matchId,
      { scoreA: 21, scoreB: 18, playedDate: '2026-09-18' },
      { now: NOW }
    );
    expect(scored.ok).toBe(true);
    expect(scored.competition.status).toBe('finished');
    expect(getCompetitionChampion(scored.competition).id).toBe('team-1');
    expect(scored.document.competitions[0].updatedAt).toBe(ISO);
  });

  it('propaga confirmação de downstream pelo documento', () => {
    const { document, competition } = seededDocument(4, 'qf');
    const [sf1, sf2] = listCompetitionRounds(competition)[0].matches;
    const after1 = setCompetitionMatchScore(document, competition.id, sf1.id, {
      scoreA: 21,
      scoreB: 10,
      playedDate: '2026-09-18',
    });
    const after2 = setCompetitionMatchScore(after1.document, competition.id, sf2.id, {
      scoreA: 21,
      scoreB: 12,
      playedDate: '2026-09-18',
    });
    const finalId = getFinalMatch(after2.competition).id;
    const finished = setCompetitionMatchScore(after2.document, competition.id, finalId, {
      scoreA: 21,
      scoreB: 19,
      playedDate: '2026-09-19',
    });
    const blocked = setCompetitionMatchScore(finished.document, competition.id, sf1.id, {
      scoreA: 8,
      scoreB: 21,
      playedDate: '2026-09-18',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.errors[0].code).toBe(COMPETITION_DOWNSTREAM_CONFIRMATION_REQUIRED);
    expect(blocked.document).toBeNull();

    const confirmed = setCompetitionMatchScore(
      finished.document,
      competition.id,
      sf1.id,
      { scoreA: 8, scoreB: 21, playedDate: '2026-09-18' },
      { downstreamConfirmed: true }
    );
    expect(confirmed.ok).toBe(true);
    expect(getFinalMatch(confirmed.competition).winnerTeamId).toBeNull();
    expect(confirmed.competition.status).toBe('in_progress');
  });

  it('limpa resultado no documento com confirmação', () => {
    const { document, competition } = seededDocument(2, 'clr');
    const matchId = listCompetitionMatches(competition)[0].id;
    const scored = setCompetitionMatchScore(document, competition.id, matchId, {
      scoreA: 21,
      scoreB: 18,
      playedDate: '2026-09-18',
    });
    const blocked = clearCompetitionMatchScore(scored.document, competition.id, matchId);
    expect(blocked.ok).toBe(false);
    const cleared = clearCompetitionMatchScore(scored.document, competition.id, matchId, {
      clearConfirmed: true,
    });
    expect(cleared.ok).toBe(true);
    expect(cleared.competition.status).toBe('in_progress');
    expect(listCompetitionMatches(cleared.competition)[0].scoreA).toBeNull();
  });

  it('adiciona times com snapshot do elenco e reordena o seeding', () => {
    const ids = sequentialIds('seed');
    const created = appendDraftCompetition(
      createEmptyCompetitionDocument(),
      { name: 'Open', date: '2026-09-18', format: { teamSize: 2 } },
      { idGenerator: ids, now: NOW }
    );
    const roster = [
      { id: 'andre', name: 'André' },
      { id: 'ana', name: 'Ana' },
      { id: 'bruno', name: 'Bruno' },
      { id: 'carla', name: 'Carla' },
    ];
    const first = addCompetitionTeam(created.document, created.competition.id, ['andre', 'ana'], {
      roster,
      idGenerator: ids,
      now: NOW,
    });
    const second = addCompetitionTeam(first.document, created.competition.id, ['bruno', 'carla'], {
      roster,
      idGenerator: ids,
      now: NOW,
    });
    expect(second.competition.teams.map((team) => team.members.map((member) => member.playerName))).toEqual([
      ['André', 'Ana'],
      ['Bruno', 'Carla'],
    ]);
    const moved = moveCompetitionTeam(second.document, created.competition.id, second.competition.teams[0].id, 1, {
      now: NOW,
    });
    expect(moved.ok).toBe(true);
    expect(moved.competition.teams.map((team) => team.members[0].playerId)).toEqual(['bruno', 'andre']);
  });
});
