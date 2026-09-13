import { describe, expect, it } from 'vitest';
import { TEAM_SESSION_SCHEMA_VERSION } from './teamSession.js';
import {
  buildPlayerPerformanceIndex,
  getCohortPartnershipMatrix,
  getCohortPartnershipPerformance,
  getCohortPlayerPerformances,
  getPlayerPerformance,
  listCohortModalities,
  listCohortPlayers,
  listPerformancePlayers,
  listSessionParticipants,
} from './playerPerformance.js';
import { uniquePartnershipCombos } from '../sessionPerformancePresentation.js';

const ISO = '2026-09-12T18:00:00.000Z';

const roster = [
  { id: 'andre', name: 'André' },
  { id: 'bh', name: 'BH' },
  { id: 'paulo', name: 'Paulo' },
  { id: 'gabi', name: 'Gabi' },
  { id: 'luiza', name: 'Luiza' },
  { id: 'wellington', name: 'Wellington' },
  { id: 'iuri', name: 'Iuri' },
  { id: 'idle', name: 'Ícaro' },
];

function member(playerId, playerName) {
  return { playerId, playerName };
}

function namesOf(ids) {
  const byId = new Map(roster.map((player) => [player.id, player.name]));
  return ids.map((id) => member(id, byId.get(id) ?? id));
}

function match({ id, teamAId = 't1', teamBId = 't2', lineupA, lineupB, scoreA, scoreB }) {
  return { id, teamAId, teamBId, lineupA, lineupB, scoreA, scoreB };
}

function historicalSession() {
  return {
    id: 'session-history',
    date: '2026-09-10',
    name: 'Histórico',
    status: 'in_progress',
    createdAt: ISO,
    updatedAt: ISO,
    format: { teamSize: 6, teamCount: 3 },
    teams: [
      { id: 't1', members: namesOf(['andre', 'wellington']) },
      { id: 't2', members: namesOf(['bh', 'gabi', 'luiza']) },
      { id: 't3', members: [member('paulo', 'Paulo'), member('bench', 'Banco')] },
    ],
    rounds: [
      {
        id: 'h-r1',
        number: 1,
        byeTeamId: 't3',
        matches: [
          match({
            id: 'h-m1',
            lineupA: namesOf(['andre', 'bh']),
            lineupB: namesOf(['gabi', 'luiza']),
            scoreA: 21,
            scoreB: 18,
          }),
        ],
      },
      {
        id: 'h-r2',
        number: 2,
        byeTeamId: 't3',
        matches: [
          match({
            id: 'h-m2',
            lineupA: namesOf(['andre', 'bh']),
            lineupB: namesOf(['gabi', 'luiza']),
            scoreA: 21,
            scoreB: 10,
          }),
        ],
      },
      {
        id: 'h-r3',
        number: 3,
        byeTeamId: 't3',
        matches: [
          match({
            id: 'h-m3',
            lineupA: namesOf(['andre', 'bh']),
            lineupB: namesOf(['gabi', 'luiza']),
            scoreA: 10,
            scoreB: 21,
          }),
        ],
      },
      {
        id: 'h-r4',
        number: 4,
        byeTeamId: 't1',
        matches: [
          match({
            id: 'h-m4',
            teamAId: 't2',
            teamBId: 't3',
            lineupA: namesOf(['paulo', 'bh']),
            lineupB: namesOf(['gabi', 'luiza']),
            scoreA: 21,
            scoreB: 15,
          }),
        ],
      },
      {
        id: 'h-r5',
        number: 5,
        byeTeamId: 't3',
        matches: [
          match({
            id: 'h-m5-pending',
            lineupA: namesOf(['andre', 'wellington']),
            lineupB: namesOf(['gabi', 'luiza']),
            scoreA: null,
            scoreB: null,
          }),
          match({
            id: 'h-m5-invalid',
            lineupA: namesOf(['andre', 'wellington']),
            lineupB: namesOf(['gabi', 'luiza']),
            scoreA: 21,
            scoreB: 21,
          }),
        ],
      },
    ],
  };
}

function draftCohortSession() {
  return {
    id: 'session-draft',
    date: '2026-09-12',
    name: 'Novo',
    status: 'draft',
    createdAt: ISO,
    updatedAt: ISO,
    format: { teamSize: 2, teamCount: 3 },
    teams: [
      { id: 't1', members: namesOf(['andre']) },
      { id: 't2', members: namesOf(['bh']) },
      { id: 't3', members: [member('paulo', 'Paulo'), member('bench', 'Banco')] },
    ],
    rounds: [],
  };
}

function currentWithExtraValidAndPending() {
  return {
    id: 'session-current-live',
    date: '2026-09-12',
    name: 'Ao vivo',
    status: 'in_progress',
    createdAt: ISO,
    updatedAt: ISO,
    format: { teamSize: 2, teamCount: 3 },
    teams: [
      { id: 't1', members: namesOf(['andre', 'iuri']) },
      { id: 't2', members: namesOf(['bh']) },
      { id: 't3', members: namesOf(['gabi']) },
    ],
    rounds: [
      {
        id: 'c-r1',
        number: 1,
        byeTeamId: 't3',
        matches: [
          match({
            id: 'c-m1',
            lineupA: namesOf(['andre', 'bh']),
            lineupB: namesOf(['gabi', 'iuri']),
            scoreA: 21,
            scoreB: 19,
          }),
          match({
            id: 'c-m2-pending',
            teamAId: 't1',
            teamBId: 't2',
            lineupA: namesOf(['andre', 'iuri']),
            lineupB: namesOf(['bh', 'gabi']),
            scoreA: null,
            scoreB: null,
          }),
        ],
      },
    ],
  };
}

function loanSession() {
  return {
    id: 'session-loan',
    date: '2026-09-11',
    name: 'Empréstimo',
    status: 'in_progress',
    createdAt: ISO,
    updatedAt: ISO,
    format: { teamSize: 2, teamCount: 2 },
    teams: [
      { id: 't1', members: namesOf(['andre']) },
      { id: 't2', members: namesOf(['gabi']) },
    ],
    rounds: [
      {
        id: 'l-r1',
        number: 1,
        byeTeamId: null,
        matches: [
          match({
            id: 'l-m1',
            lineupA: namesOf(['andre', 'paulo']),
            lineupB: namesOf(['gabi', 'luiza']),
            scoreA: 21,
            scoreB: 12,
          }),
        ],
      },
    ],
  };
}

function wellingtonFivesSession() {
  return {
    id: 'session-fives',
    date: '2026-09-09',
    name: '5x5',
    status: 'finished',
    createdAt: ISO,
    updatedAt: ISO,
    format: { teamSize: 5, teamCount: 2 },
    teams: [
      { id: 't1', members: namesOf(['wellington', 'andre', 'bh', 'gabi', 'luiza']) },
      { id: 't2', members: namesOf(['paulo', 'iuri']) },
    ],
    rounds: [
      {
        id: 'f-r1',
        number: 1,
        byeTeamId: null,
        matches: [
          match({
            id: 'f-m1',
            lineupA: namesOf(['wellington', 'andre', 'bh', 'gabi', 'luiza']),
            lineupB: [
              member('paulo', 'Paulo'),
              member('iuri', 'Iuri'),
              member('geo', 'Geo'),
              member('helen', 'Helen'),
              member('bench', 'Banco'),
            ],
            scoreA: 25,
            scoreB: 20,
          }),
        ],
      },
    ],
  };
}

function documentOf(...sessions) {
  return { schemaVersion: TEAM_SESSION_SCHEMA_VERSION, sessions };
}

function matrixMatches(matrix, playerId, partnerId) {
  const row = matrix.rows.find((item) => item.playerId === playerId);
  const cell = row.cells.find((item) => item.partnerId === partnerId);
  return cell.matches;
}

function requiredDocument() {
  return documentOf(historicalSession(), draftCohortSession());
}

describe('coorte do encontro sobre histórico global', () => {
  it('encontro novo sem partidas mostra o histórico anterior dos participantes', () => {
    const document = requiredDocument();
    const index = buildPlayerPerformanceIndex(document, roster).index;
    const cohort = listSessionParticipants(document, roster, 'session-draft');
    expect(cohort.ok).toBe(true);
    expect(cohort.participantIds).toEqual(expect.arrayContaining(['andre', 'bh', 'paulo', 'bench']));
    expect(cohort.participantIds).not.toContain('idle');
    expect(cohort.participants.find((player) => player.playerId === 'bench')).toMatchObject({
      playerName: 'Banco',
      isCurrentRosterPlayer: false,
    });

    const rows = getCohortPlayerPerformances(index, cohort.participantIds);
    expect(rows.find((player) => player.playerId === 'andre').matches).toBeGreaterThan(0);
    expect(rows.find((player) => player.playerId === 'bench').matches).toBe(0);
    expect(rows.some((player) => player.playerId === 'idle')).toBe(false);
    expect(listPerformancePlayers(index).some((player) => player.playerId === 'idle')).toBe(true);
  });

  it('confirma André×BH=3, André×Paulo=0, Paulo×BH=1 no draft', () => {
    const document = requiredDocument();
    const index = buildPlayerPerformanceIndex(document, roster).index;
    const { participantIds } = listSessionParticipants(document, roster, 'session-draft');
    const matrix = getCohortPartnershipMatrix(index, participantIds);

    expect(matrixMatches(matrix, 'andre', 'bh')).toBe(3);
    expect(matrixMatches(matrix, 'bh', 'andre')).toBe(3);
    expect(matrixMatches(matrix, 'andre', 'paulo')).toBe(0);
    expect(matrixMatches(matrix, 'paulo', 'andre')).toBe(0);
    expect(matrixMatches(matrix, 'paulo', 'bh')).toBe(1);
    expect(matrixMatches(matrix, 'bh', 'paulo')).toBe(1);

    const diagonal = matrix.rows
      .find((row) => row.playerId === 'andre')
      .cells.find((cell) => cell.partnerId === 'andre');
    expect(diagonal.diagonal).toBe(true);
    expect(diagonal.matches).toBeNull();
    expect(uniquePartnershipCombos(matrix.players).some((item) => item.playerId === 'andre' && item.partnerId === 'paulo')).toBe(
      true
    );
    expect(getCohortPartnershipPerformance(index, 'andre', 'bh').matches).toBe(3);
    expect(getCohortPartnershipPerformance(index, 'andre', 'paulo').matches).toBe(0);
    expect(getCohortPartnershipPerformance(index, 'paulo', 'bh').matches).toBe(1);
  });

  it('inclui o próprio encontro quando há placar válido e ignora pendências', () => {
    const withoutCurrent = documentOf(historicalSession(), draftCohortSession());
    const withCurrent = documentOf(historicalSession(), currentWithExtraValidAndPending());
    const base = buildPlayerPerformanceIndex(withoutCurrent, roster).index;
    const live = buildPlayerPerformanceIndex(withCurrent, roster).index;
    const draftIds = listSessionParticipants(withoutCurrent, roster, 'session-draft').participantIds;
    const liveIds = listSessionParticipants(withCurrent, roster, 'session-current-live').participantIds;

    expect(getCohortPartnershipPerformance(base, 'andre', 'bh').matches).toBe(3);
    expect(getCohortPartnershipPerformance(live, 'andre', 'bh').matches).toBe(4);
    expect(getCohortPlayerPerformances(live, liveIds).find((player) => player.playerId === 'iuri').matches).toBe(1);
    expect(live.skippedPendingMatches).toBeGreaterThan(withoutCurrent && base.skippedPendingMatches);
    expect(getPlayerPerformance(live, 'andre').matches).toBe(
      getCohortPlayerPerformances(live, liveIds).find((player) => player.playerId === 'andre').matches
    );
    expect(draftIds).not.toContain('iuri');
    expect(liveIds).toContain('iuri');
  });

  it('jogador emprestado entra na coorte pela lineup', () => {
    const document = documentOf(historicalSession(), loanSession());
    const cohort = listSessionParticipants(document, roster, 'session-loan');
    expect(cohort.participantIds).toEqual(expect.arrayContaining(['andre', 'paulo', 'gabi', 'luiza']));
    expect(cohort.participantIds).not.toContain('bh');
  });

  it('modalidades vêm do histórico da coorte e o filtro não remove zerados', () => {
    const document = documentOf(historicalSession(), wellingtonFivesSession(), draftCohortSession());
    const index = buildPlayerPerformanceIndex(document, roster).index;
    const { participantIds } = listSessionParticipants(document, roster, 'session-draft');
    const modalities = listCohortModalities(index, participantIds);
    expect(modalities).toEqual(expect.arrayContaining([2, 5]));
    const filtered = getCohortPartnershipMatrix(index, participantIds, { lineupSize: 5 });
    expect(filtered.rows).toHaveLength(listCohortPlayers(index, participantIds).length);
    expect(matrixMatches(filtered, 'andre', 'paulo')).toBe(0);
    expect(filtered.rows.find((row) => row.playerId === 'bench')).toBeTruthy();
    expect(getCohortPlayerPerformances(index, participantIds, { lineupSize: 2 }).find((player) => player.playerId === 'andre').modalities).toEqual(
      [2]
    );
  });

  it('trocar o encontro muda a coorte e preserva o histórico do mesmo par', () => {
    const document = documentOf(historicalSession(), draftCohortSession(), loanSession());
    const index = buildPlayerPerformanceIndex(document, roster).index;
    const draftIds = listSessionParticipants(document, roster, 'session-draft').participantIds;
    const loanIds = listSessionParticipants(document, roster, 'session-loan').participantIds;
    expect(draftIds).toContain('bh');
    expect(loanIds).not.toContain('bh');
    expect(getCohortPartnershipPerformance(index, 'andre', 'paulo').matches).toBe(
      getCohortPartnershipPerformance(index, 'andre', 'paulo').matches
    );
    expect(matrixMatches(getCohortPartnershipMatrix(index, draftIds), 'andre', 'bh')).toBe(
      matrixMatches(getCohortPartnershipMatrix(index, [...draftIds, 'gabi']), 'andre', 'bh')
    );
    expect(matrixMatches(getCohortPartnershipMatrix(index, loanIds), 'andre', 'paulo')).toBe(
      getCohortPartnershipPerformance(index, 'andre', 'paulo').matches
    );
  });

  it('rejeita sessão inexistente, não muta a entrada e congela retornos', () => {
    const document = requiredDocument();
    const snapshot = JSON.parse(JSON.stringify(document));
    const rosterSnapshot = JSON.parse(JSON.stringify(roster));
    const missing = listSessionParticipants(document, roster, 'nope');
    expect(missing.ok).toBe(false);
    expect(missing.participantIds).toBeNull();
    expect(missing.errors[0].code).toBe('SESSION_NOT_FOUND');
    expect(listSessionParticipants(document, roster, '').errors[0].code).toBe('SESSION_ID_INVALID');

    const built = buildPlayerPerformanceIndex(document, roster);
    const { participantIds } = listSessionParticipants(document, roster, 'session-draft');
    const matrix = getCohortPartnershipMatrix(built.index, participantIds);
    const rows = getCohortPlayerPerformances(built.index, participantIds);
    expect(document).toEqual(snapshot);
    expect(roster).toEqual(rosterSnapshot);
    expect(() => matrix.rows.push({})).toThrow();
    expect(() => rows.push({})).toThrow();
    document.sessions[0].rounds = [];
    expect(getCohortPartnershipPerformance(built.index, 'andre', 'bh').matches).toBe(3);
  });

  it('dashboard global continua somando todas as sessões', () => {
    const document = documentOf(historicalSession(), draftCohortSession(), loanSession());
    const global = buildPlayerPerformanceIndex(document, roster);
    expect(global.ok).toBe(true);
    expect(global.index).toEqual({
      includedMatches: global.index.includedMatches,
      skippedPendingMatches: global.index.skippedPendingMatches,
      skippedInvalidMatches: global.index.skippedInvalidMatches,
    });
    expect(Object.prototype.hasOwnProperty.call(global.index, 'sessionId')).toBe(false);
    const loanIds = listSessionParticipants(document, roster, 'session-loan').participantIds;
    expect(loanIds).not.toContain('idle');
    expect(getPlayerPerformance(global.index, 'andre').matches).toBeGreaterThan(0);
    expect(listPerformancePlayers(global.index).some((player) => player.playerId === 'idle')).toBe(true);
  });

  it('homônimos continuam separados por ID', () => {
    const twins = documentOf({
      id: 'session-twins',
      date: '2026-09-12',
      name: 'Gêmeos',
      status: 'draft',
      createdAt: ISO,
      updatedAt: ISO,
      format: { teamSize: 2, teamCount: 2 },
      teams: [
        { id: 't1', members: [member('andre-1', 'André')] },
        { id: 't2', members: [member('andre-2', 'André')] },
      ],
      rounds: [],
    });
    const cohort = listSessionParticipants(twins, [{ id: 'andre-1', name: 'André' }], 'session-twins');
    expect(cohort.participantIds).toEqual(expect.arrayContaining(['andre-1', 'andre-2']));
    const listed = listCohortPlayers(buildPlayerPerformanceIndex(twins, [{ id: 'andre-1', name: 'André' }]).index, cohort.participantIds);
    expect(listed.map((player) => player.playerId).sort()).toEqual(['andre-1', 'andre-2']);
  });
});
