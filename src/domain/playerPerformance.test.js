import { describe, expect, it } from 'vitest';
import { TEAM_SESSION_SCHEMA_VERSION, validateV2Document } from './teamSession.js';
import { isMatchCompleted, isMatchPending } from './sessionValidation.js';
import {
  deleteTeamSession,
  setTeamSessionMatchLineups,
  setTeamSessionMatchScore,
} from '../teamGameSessions.js';
import {
  ANALYSIS_SCORE_ERROR_CODES,
  MATCH_SOURCE_COMPETITION,
  MATCH_SOURCE_SESSION,
  buildPartnershipRepeatLookup,
  buildPlayerPerformanceIndex,
  formatPerformanceModality,
  RANKING_SORT_FIELDS,
  getBestPartner,
  getPlayerMatchHistory,
  getPlayerPartnerMatchHistory,
  getPlayerPartnerPerformance,
  getPlayerPerformance,
  getPlayerPerformanceRanking,
  listPerformancePlayers,
} from './playerPerformance.js';
import {
  applyCompetitionMatchResult,
  cloneCompetition,
  createDraftCompetition,
  createEmptyCompetitionDocument,
  generateCompetitionBracket,
  listCompetitionMatches,
  listCompetitionRounds,
  setDraftCompetitionTeams,
} from './competition.js';

const ISO = '2026-09-12T18:00:00.000Z';
const LATER = '2026-09-12T20:00:00.000Z';

const roster = [
  { id: 'andre', name: 'André' },
  { id: 'ana', name: 'Ana' },
  { id: 'bruno', name: 'Bruno' },
  { id: 'carla', name: 'Carla' },
  { id: 'diego', name: 'Diego' },
  { id: 'erika', name: 'Erika' },
  { id: 'fabio', name: 'Fábio' },
  { id: 'gabi', name: 'Gabi' },
  { id: 'luiza', name: 'Luiza' },
  { id: 'geo', name: 'Geo' },
  { id: 'helen', name: 'Helen' },
];

function member(playerId, playerName) {
  return { playerId, playerName };
}

function team(id, members) {
  return { id, members };
}

function namesOf(ids) {
  const byId = new Map(roster.map((player) => [player.id, player.name]));
  return ids.map((id) => member(id, byId.get(id) ?? id));
}

function matchShape({
  id = 'match-1',
  teamAId = 't1',
  teamBId = 't2',
  lineupA,
  lineupB,
  scoreA = null,
  scoreB = null,
}) {
  return { id, teamAId, teamBId, lineupA, lineupB, scoreA, scoreB };
}

function session({
  id = 'session-1',
  date = '2026-09-12',
  name = 'Arena',
  status = 'in_progress',
  createdAt = ISO,
  updatedAt = ISO,
  format = { teamSize: 2, teamCount: 2 },
  teams,
  rounds,
} = {}) {
  return {
    id,
    date,
    name,
    status,
    createdAt,
    updatedAt,
    format,
    teams,
    rounds,
  };
}

function documentOf(...sessions) {
  return { schemaVersion: TEAM_SESSION_SCHEMA_VERSION, sessions };
}

function doublesSession({
  id = 'session-2x2',
  status = 'in_progress',
  scoreA = 21,
  scoreB = 18,
  lineupA = namesOf(['andre', 'ana']),
  lineupB = namesOf(['gabi', 'luiza']),
  date = '2026-09-12',
  name = 'Arena',
  updatedAt = ISO,
  createdAt = ISO,
} = {}) {
  return session({
    id,
    date,
    name,
    status,
    createdAt,
    updatedAt,
    format: { teamSize: 2, teamCount: 2 },
    teams: [
      team('t1', namesOf(['andre', 'ana'])),
      team('t2', namesOf(['gabi', 'luiza'])),
    ],
    rounds: [
      {
        id: `${id}-r1`,
        number: 1,
        byeTeamId: null,
        matches: [
          matchShape({
            id: `${id}-m1`,
            lineupA,
            lineupB,
            scoreA,
            scoreB,
          }),
        ],
      },
    ],
  });
}

function sixesSession({
  scoreA = 25,
  scoreB = 22,
  lineupA = namesOf(['andre', 'bruno', 'carla', 'diego', 'erika', 'fabio']),
  lineupB = namesOf(['gabi', 'luiza', 'geo', 'ana', 'helen']),
} = {}) {
  const teamA = namesOf(['andre', 'bruno', 'carla', 'diego', 'erika', 'fabio']);
  const teamB = namesOf(['gabi', 'luiza', 'ana', 'helen']);
  const teamC = namesOf(['geo']);
  return session({
    id: 'session-6x6',
    name: 'Sábado 6x6',
    status: 'finished',
    format: { teamSize: 6, teamCount: 3 },
    teams: [team('t1', teamA), team('t2', teamB), team('t3', teamC)],
    rounds: [
      {
        id: 'six-r1',
        number: 1,
        byeTeamId: 't3',
        matches: [
          matchShape({
            id: 'six-m1',
            teamAId: 't1',
            teamBId: 't2',
            lineupA,
            lineupB,
            scoreA,
            scoreB,
          }),
        ],
      },
    ],
  });
}

function indexOf(document, currentRoster = roster, options) {
  const result = buildPlayerPerformanceIndex(document, currentRoster, options);
  expect(result.ok).toBe(true);
  return result.index;
}

function appendDoublesRound(base, { id, scoreA, scoreB, lineupA, lineupB } = {}) {
  const first = base.rounds[0].matches[0];
  return {
    ...base,
    rounds: [
      ...base.rounds,
      {
        id,
        number: base.rounds.length + 1,
        byeTeamId: null,
        matches: [
          matchShape({
            id: `${id}-m`,
            lineupA: lineupA ?? first.lineupA,
            lineupB: lineupB ?? first.lineupB,
            scoreA,
            scoreB,
          }),
        ],
      },
    ],
  };
}

function errorCodes(result) {
  return (result.errors ?? []).map((item) => item.code);
}

describe('formatPerformanceModality', () => {
  it('deriva o rótulo a partir do tamanho real da lineup', () => {
    expect(formatPerformanceModality(1)).toBe('1x1');
    expect(formatPerformanceModality(5)).toBe('5x5');
    expect(formatPerformanceModality(6)).toBe('6x6');
    expect(formatPerformanceModality(2.5)).toBe('');
  });
});

describe('buildPlayerPerformanceIndex', () => {
  it('aceita documento sem encontros', () => {
    const result = buildPlayerPerformanceIndex(documentOf(), roster);
    expect(result.ok).toBe(true);
    expect(result.index).toEqual({
      includedMatches: 0,
      skippedPendingMatches: 0,
      skippedInvalidMatches: 0,
    });
    expect(getPlayerPerformance(result.index, 'andre').matches).toBe(0);
    expect(getPlayerPerformance(result.index, 'andre').winRate).toBe(0);
  });

  it('ignora encontro somente com partidas pendentes', () => {
    const index = indexOf(documentOf(doublesSession({ scoreA: null, scoreB: null })));
    expect(index).toMatchObject({
      includedMatches: 0,
      skippedPendingMatches: 1,
      skippedInvalidMatches: 0,
    });
    expect(getPlayerPerformance(index, 'andre').matches).toBe(0);
  });

  it('inclui placar válido em in_progress e finished', () => {
    const index = indexOf(
      documentOf(
        doublesSession({ status: 'in_progress', scoreA: 21, scoreB: 18 }),
        doublesSession({
          id: 'finished-2x2',
          status: 'finished',
          scoreA: 15,
          scoreB: 21,
        })
      )
    );
    expect(index.includedMatches).toBe(2);
    expect(getPlayerPerformance(index, 'andre')).toMatchObject({
      matches: 2,
      wins: 1,
      losses: 1,
      winRate: 0.5,
      pointsFor: 36,
      averagePointsFor: 18,
      pointsAgainst: 39,
      averagePointsAgainst: 19.5,
      pointDifference: -3,
    });
  });

  it('diagnostica placar inválido, empate e parcial sem lançar', () => {
    const invalid = doublesSession({ id: 'invalid', scoreA: 21, scoreB: 21 });
    const partial = doublesSession({ id: 'partial', scoreA: 21, scoreB: null });
    const negative = doublesSession({ id: 'negative', scoreA: -1, scoreB: 10 });
    const fractional = doublesSession({ id: 'fractional', scoreA: 21.5, scoreB: 18 });
    const pending = doublesSession({ id: 'pending', scoreA: null, scoreB: null });
    const result = buildPlayerPerformanceIndex(
      documentOf(invalid, partial, negative, fractional, pending, doublesSession()),
      roster
    );
    expect(result.ok).toBe(true);
    expect(result.index).toMatchObject({
      includedMatches: 1,
      skippedPendingMatches: 1,
      skippedInvalidMatches: 4,
    });
  });

  it('rejeita documento estruturalmente inválido sem agregado parcial', () => {
    const result = buildPlayerPerformanceIndex({ schemaVersion: 1, sessions: [] }, roster);
    expect(result.ok).toBe(false);
    expect(result.index).toBeNull();
    expect(result.errors[0].code).toBe('SCHEMA_VERSION_UNSUPPORTED');
  });

  it('tolera somente a lista explícita de erros de placar', () => {
    expect([...ANALYSIS_SCORE_ERROR_CODES]).toEqual([
      'SCORE_INVALID_TYPE',
      'SCORE_NOT_INTEGER',
      'SCORE_NEGATIVE',
      'SCORE_TIE',
      'SCORE_PARTIAL',
    ]);
    expect(ANALYSIS_SCORE_ERROR_CODES).not.toContain('FINALIZE_INCOMPLETE');
    expect(ANALYSIS_SCORE_ERROR_CODES).not.toContain('PLAYER_SCORE_INVALID');
  });

  it('em in_progress inclui a partida válida e diagnostica a pendente', () => {
    const mixed = appendDoublesRound(doublesSession({ scoreA: 21, scoreB: 18 }), {
      id: 'pending-round',
      scoreA: null,
      scoreB: null,
    });
    const document = documentOf(mixed);
    expect(validateV2Document(document).ok).toBe(true);
    const result = buildPlayerPerformanceIndex(document, roster);
    expect(result.ok).toBe(true);
    expect(result.index).toEqual({
      includedMatches: 1,
      skippedPendingMatches: 1,
      skippedInvalidMatches: 0,
    });
    expect(getPlayerPerformance(result.index, 'andre').matches).toBe(1);
  });

  it('em in_progress agrega a válida e ignora o empate sem parcial da inválida', () => {
    const mixed = appendDoublesRound(doublesSession({ scoreA: 21, scoreB: 18 }), {
      id: 'tie-round',
      scoreA: 21,
      scoreB: 21,
    });
    const document = documentOf(mixed);
    expect(errorCodes(validateV2Document(document))).toEqual(['SCORE_TIE']);
    const result = buildPlayerPerformanceIndex(document, roster);
    expect(result.ok).toBe(true);
    expect(result.index).toEqual({
      includedMatches: 1,
      skippedPendingMatches: 0,
      skippedInvalidMatches: 1,
    });
    expect(getPlayerPerformance(result.index, 'andre')).toMatchObject({
      matches: 1,
      wins: 1,
      pointsFor: 21,
      pointsAgainst: 18,
    });
    expect(getPlayerPartnerPerformance(result.index, 'andre')).toHaveLength(1);
  });

  it('classifica placar parcial conforme os helpers e não gera participação', () => {
    const partialMatch = {
      scoreA: 21,
      scoreB: null,
    };
    expect(isMatchPending(partialMatch)).toBe(false);
    expect(isMatchCompleted(partialMatch)).toBe(false);
    const document = documentOf(doublesSession({ scoreA: 21, scoreB: null }));
    expect(errorCodes(validateV2Document(document))).toEqual(['SCORE_PARTIAL']);
    const result = buildPlayerPerformanceIndex(document, roster);
    expect(result.ok).toBe(true);
    expect(result.index).toEqual({
      includedMatches: 0,
      skippedPendingMatches: 0,
      skippedInvalidMatches: 1,
    });
    expect(getPlayerPerformance(result.index, 'andre').matches).toBe(0);
    expect(getPlayerPartnerPerformance(result.index, 'andre')).toEqual([]);
  });

  it('rejeita placar inválido combinado com referência estrutural quebrada', () => {
    const broken = doublesSession({ scoreA: 21, scoreB: 21 });
    broken.rounds[0].matches[0].teamBId = 'missing-team';
    const result = buildPlayerPerformanceIndex(documentOf(broken), roster);
    expect(result.ok).toBe(false);
    expect(result.index).toBeNull();
    expect(errorCodes(result)).toContain('MATCH_TEAM_NOT_FOUND');
    expect(errorCodes(result)).not.toContain('SCORE_TIE');
  });

  it('rejeita placar inválido combinado com ID duplicado', () => {
    const duplicate = doublesSession({ scoreA: 21, scoreB: 21 });
    duplicate.rounds[0].matches.push(
      matchShape({
        id: duplicate.rounds[0].matches[0].id,
        lineupA: namesOf(['andre', 'ana']),
        lineupB: namesOf(['gabi', 'luiza']),
        scoreA: 21,
        scoreB: 18,
      })
    );
    const result = buildPlayerPerformanceIndex(documentOf(duplicate), roster);
    expect(result.ok).toBe(false);
    expect(result.index).toBeNull();
    expect(errorCodes(result)).toContain('MATCH_ID_DUPLICATE');
  });

  it('rejeita encontro finished inconsistente em vez de diagnosticar só o placar', () => {
    const pendingFinished = documentOf(doublesSession({ status: 'finished', scoreA: null, scoreB: null }));
    expect(errorCodes(validateV2Document(pendingFinished))).toEqual(['FINALIZE_INCOMPLETE']);
    const pendingResult = buildPlayerPerformanceIndex(pendingFinished, roster);
    expect(pendingResult.ok).toBe(false);
    expect(pendingResult.index).toBeNull();
    expect(errorCodes(pendingResult)).toEqual(['FINALIZE_INCOMPLETE']);

    const tiedFinished = documentOf(doublesSession({ status: 'finished', scoreA: 21, scoreB: 21 }));
    expect(errorCodes(validateV2Document(tiedFinished))).toEqual(
      expect.arrayContaining(['SCORE_TIE', 'FINALIZE_INCOMPLETE'])
    );
    const tiedResult = buildPlayerPerformanceIndex(tiedFinished, roster);
    expect(tiedResult.ok).toBe(false);
    expect(tiedResult.index).toBeNull();
    expect(errorCodes(tiedResult)).toEqual(['FINALIZE_INCOMPLETE']);
  });

  it('aceita documento gravável que passa integralmente por validateV2Document', () => {
    const document = documentOf(doublesSession(), sixesSession());
    expect(validateV2Document(document).ok).toBe(true);
    const result = buildPlayerPerformanceIndex(document, roster);
    expect(result.ok).toBe(true);
    expect(result.index.includedMatches).toBe(2);
  });
});

describe('métricas individuais e modalidade por lado', () => {
  it('inverte vitória, derrota e pontos pró/contra nos dois lados', () => {
    const index = indexOf(documentOf(doublesSession({ scoreA: 21, scoreB: 18 })));
    expect(getPlayerPerformance(index, 'andre')).toMatchObject({
      playerId: 'andre',
      matches: 1,
      wins: 1,
      losses: 0,
      winRate: 1,
      pointsFor: 21,
      pointsAgainst: 18,
      pointDifference: 3,
    });
    expect(getPlayerPerformance(index, 'gabi')).toMatchObject({
      matches: 1,
      wins: 0,
      losses: 1,
      winRate: 0,
      pointsFor: 18,
      pointsAgainst: 21,
      pointDifference: -3,
    });
  });

  it('classifica 6 contra 5 pela lineup real de cada lado', () => {
    const index = indexOf(documentOf(sixesSession()));
    expect(getPlayerPerformance(index, 'andre').modalities).toEqual([6]);
    expect(formatPerformanceModality(getPlayerPerformance(index, 'andre').modalities[0])).toBe(
      '6x6'
    );
    expect(getPlayerPerformance(index, 'gabi').modalities).toEqual([5]);
    expect(getPlayerPerformance(index, 'andre', { lineupSize: 6 }).matches).toBe(1);
    expect(getPlayerPerformance(index, 'gabi', { lineupSize: 5 }).matches).toBe(1);
    expect(getPlayerPerformance(index, 'andre', { lineupSize: 5 }).matches).toBe(0);
  });

  it('gera categoria 1x1 para lineup de um jogador', () => {
    const oneVsTwo = session({
      format: { teamSize: 2, teamCount: 2 },
      teams: [team('t1', namesOf(['andre', 'ana'])), team('t2', namesOf(['gabi', 'luiza']))],
      rounds: [
        {
          id: 'r1',
          number: 1,
          byeTeamId: null,
          matches: [
            matchShape({
              lineupA: namesOf(['andre']),
              lineupB: namesOf(['gabi', 'luiza']),
              scoreA: 21,
              scoreB: 15,
            }),
          ],
        },
      ],
    });
    const index = indexOf(documentOf(oneVsTwo));
    expect(getPlayerPerformance(index, 'andre').modalities).toEqual([1]);
    expect(formatPerformanceModality(1)).toBe('1x1');
    expect(getPlayerPerformance(index, 'gabi').modalities).toEqual([2]);
    expect(index.includedMatches).toBe(1);
  });

  it('não conta jogador do time-base ausente da lineup e conta empréstimo no lado real', () => {
    const loaned = session({
      format: { teamSize: 6, teamCount: 3 },
      teams: [
        team('t1', namesOf(['andre', 'bruno', 'carla'])),
        team('t2', namesOf(['gabi', 'luiza'])),
        team('t3', namesOf(['geo', 'ana'])),
      ],
      rounds: [
        {
          id: 'r1',
          number: 1,
          byeTeamId: 't3',
          matches: [
            matchShape({
              teamAId: 't1',
              teamBId: 't2',
              lineupA: namesOf(['andre', 'geo']),
              lineupB: namesOf(['gabi']),
              scoreA: 21,
              scoreB: 10,
            }),
          ],
        },
      ],
    });
    const index = indexOf(documentOf(loaned));
    expect(getPlayerPerformance(index, 'bruno').matches).toBe(0);
    expect(getPlayerPerformance(index, 'ana').matches).toBe(0);
    expect(getPlayerPerformance(index, 'geo')).toMatchObject({
      matches: 1,
      wins: 1,
      pointsFor: 21,
      pointsAgainst: 10,
    });
    expect(getPlayerPartnerPerformance(index, 'andre').map((item) => item.partnerId)).toEqual([
      'geo',
    ]);
  });
});

describe('parceiros e filtros', () => {
  it('registra os outros integrantes da mesma lineup de seis e ignora adversários', () => {
    const index = indexOf(documentOf(sixesSession()));
    const partners = getPlayerPartnerPerformance(index, 'andre');
    expect(partners.map((item) => item.partnerId).sort()).toEqual([
      'bruno',
      'carla',
      'diego',
      'erika',
      'fabio',
    ]);
    expect(partners.every((item) => item.matches === 1 && item.wins === 1)).toBe(true);
    expect(partners.map((item) => item.partnerId)).not.toContain('gabi');
    expect(partners.map((item) => item.partnerId)).not.toContain('andre');
  });

  it('separa o mesmo parceiro em modalidades diferentes', () => {
    const togetherAtSix = sixesSession({
      lineupA: namesOf(['andre', 'ana', 'bruno', 'carla', 'diego', 'erika']),
      lineupB: namesOf(['gabi', 'luiza', 'fabio', 'geo', 'helen']),
    });
    const index = indexOf(documentOf(doublesSession(), togetherAtSix));
    const ana = getPlayerPartnerPerformance(index, 'andre', { partnerId: 'ana' });
    expect(ana).toHaveLength(1);
    expect(ana[0]).toMatchObject({ matches: 2, wins: 2 });
    expect(ana[0].modalities).toEqual([2, 6]);
    expect(
      getPlayerPartnerPerformance(index, 'andre', { partnerId: 'ana', lineupSize: 2 })[0]
    ).toMatchObject({ matches: 1, wins: 1 });
    expect(
      getPlayerPerformance(index, 'andre', { partnerId: 'ana', lineupSize: 2 })
    ).toMatchObject({ matches: 1, wins: 1, pointsFor: 21 });
    expect(
      getPlayerPerformance(index, 'andre', { partnerId: 'ana', lineupSize: 6 })
    ).toMatchObject({ matches: 1, pointsFor: 25 });
  });

  it('filtra somente por modalidade, somente por parceiro e de forma combinada', () => {
    const index = indexOf(documentOf(doublesSession(), sixesSession()));
    expect(getPlayerPerformance(index, 'andre', { lineupSize: 2 }).matches).toBe(1);
    expect(getPlayerPerformance(index, 'andre', { lineupSize: 6 }).matches).toBe(1);
    expect(getPlayerPerformance(index, 'andre', { partnerId: 'ana' }).matches).toBe(1);
    expect(getPlayerPerformance(index, 'andre', { partnerId: 'bruno' }).matches).toBe(1);
    expect(
      getPlayerPerformance(index, 'andre', { partnerId: 'ana', lineupSize: 6 }).matches
    ).toBe(0);
    expect(
      getPlayerPerformance(index, 'andre', { partnerId: 'gabi' }).matches
    ).toBe(0);
  });
});

describe('melhor parceiro', () => {
  it('escolhe 100% em uma única partida e aplica os desempates na ordem', () => {
    const oneWin = doublesSession({ scoreA: 21, scoreB: 10 });
    const index = indexOf(documentOf(oneWin));
    const best = getBestPartner(index, 'andre');
    expect(best).toMatchObject({
      partnerId: 'ana',
      matches: 1,
      wins: 1,
      winRate: 1,
    });
    expect(getBestPartner(index, 'fabio')).toBeNull();

    const tied = session({
      id: 'tie-break',
      format: { teamSize: 6, teamCount: 3 },
      teams: [
        team('t1', namesOf(['andre', 'bruno', 'carla'])),
        team('t2', namesOf(['gabi', 'luiza'])),
        team('t3', namesOf(['geo', 'fabio'])),
      ],
      rounds: [
        {
          id: 'r1',
          number: 1,
          byeTeamId: null,
          matches: [
            matchShape({
              id: 'm1',
              teamAId: 't1',
              teamBId: 't2',
              lineupA: namesOf(['andre', 'bruno']),
              lineupB: namesOf(['gabi', 'luiza']),
              scoreA: 21,
              scoreB: 18,
            }),
            matchShape({
              id: 'm2',
              teamAId: 't1',
              teamBId: 't3',
              lineupA: namesOf(['andre', 'carla']),
              lineupB: namesOf(['geo', 'fabio']),
              scoreA: 21,
              scoreB: 18,
            }),
          ],
        },
      ],
    });
    const tiedIndex = indexOf(documentOf(tied));
    expect(getBestPartner(tiedIndex, 'andre').partnerId).toBe('bruno');
  });

  it('compara winRate cru e só usa pt-BR depois dos desempates numéricos', () => {
    const rounds = [];
    const add = (id, partner, scoreA, scoreB) => {
      rounds.push({
        id: `r-${id}`,
        number: rounds.length + 1,
        byeTeamId: 't3',
        matches: [
          matchShape({
            id: `m-${id}`,
            teamAId: 't1',
            teamBId: 't2',
            lineupA: namesOf(['andre', partner]),
            lineupB: namesOf(['gabi', 'luiza']),
            scoreA,
            scoreB,
          }),
        ],
      });
    };
    add('b1', 'bruno', 21, 10);
    add('b2', 'bruno', 21, 10);
    add('b3', 'bruno', 10, 21);
    add('c1', 'carla', 21, 10);
    add('c2', 'carla', 21, 10);
    add('c3', 'carla', 21, 10);
    add('c4', 'carla', 10, 21);
    add('c5', 'carla', 10, 21);
    const ranked = session({
      format: { teamSize: 2, teamCount: 3 },
      teams: [
        team('t1', namesOf(['andre'])),
        team('t2', namesOf(['gabi', 'luiza'])),
        team('t3', namesOf(['bruno', 'carla'])),
      ],
      rounds,
    });
    const index = indexOf(documentOf(ranked));
    const partners = getPlayerPartnerPerformance(index, 'andre');
    const bruno = partners.find((item) => item.partnerId === 'bruno');
    const carla = partners.find((item) => item.partnerId === 'carla');
    expect(bruno.winRate).toBe(2 / 3);
    expect(carla.winRate).toBe(3 / 5);
    expect(bruno.winRate).toBeGreaterThan(carla.winRate);
    expect(getBestPartner(index, 'andre').partnerId).toBe('bruno');

    const nameDoesNotOverride = session({
      format: { teamSize: 2, teamCount: 3 },
      teams: [
        team('t1', namesOf(['andre'])),
        team('t2', namesOf(['gabi', 'luiza'])),
        team('t3', namesOf(['bruno'])),
      ],
      rounds: [
        {
          id: 'r-win',
          number: 1,
          byeTeamId: 't3',
          matches: [
            matchShape({
              id: 'm-win',
              teamAId: 't1',
              teamBId: 't2',
              lineupA: [member('andre', 'André'), member('zulu', 'Zulu')],
              lineupB: namesOf(['gabi', 'luiza']),
              scoreA: 21,
              scoreB: 10,
            }),
          ],
        },
        {
          id: 'r-loss',
          number: 2,
          byeTeamId: 't3',
          matches: [
            matchShape({
              id: 'm-loss',
              teamAId: 't1',
              teamBId: 't2',
              lineupA: [member('andre', 'André'), member('ana', 'Ana')],
              lineupB: namesOf(['gabi', 'luiza']),
              scoreA: 10,
              scoreB: 21,
            }),
          ],
        },
      ],
    });
    nameDoesNotOverride.teams[2] = team('t3', [member('zulu', 'Zulu'), member('ana', 'Ana')]);
    expect(getBestPartner(indexOf(documentOf(nameDoesNotOverride)), 'andre').partnerId).toBe('zulu');
  });

  it('desempata nomes equivalentes por partnerId', () => {
    const twins = session({
      format: { teamSize: 2, teamCount: 3 },
      teams: [
        team('t1', namesOf(['andre'])),
        team('t2', namesOf(['gabi', 'luiza'])),
        team('t3', [member('z-ana', 'Ana'), member('a-ana', 'Ána')]),
      ],
      rounds: [
        {
          id: 'r1',
          number: 1,
          byeTeamId: 't3',
          matches: [
            matchShape({
              id: 'm1',
              teamAId: 't1',
              teamBId: 't2',
              lineupA: [member('andre', 'André'), member('z-ana', 'Ana')],
              lineupB: namesOf(['gabi', 'luiza']),
              scoreA: 21,
              scoreB: 18,
            }),
          ],
        },
        {
          id: 'r2',
          number: 2,
          byeTeamId: 't3',
          matches: [
            matchShape({
              id: 'm2',
              teamAId: 't1',
              teamBId: 't2',
              lineupA: [member('andre', 'André'), member('a-ana', 'Ána')],
              lineupB: namesOf(['gabi', 'luiza']),
              scoreA: 21,
              scoreB: 18,
            }),
          ],
        },
      ],
    });
    const namedRoster = [
      ...roster,
      { id: 'z-ana', name: 'Ana' },
      { id: 'a-ana', name: 'Ána' },
    ];
    const index = indexOf(documentOf(twins), namedRoster);
    const partners = getPlayerPartnerPerformance(index, 'andre');
    expect(partners.map((item) => item.partnerId)).toEqual(['a-ana', 'z-ana']);
    expect(getBestPartner(index, 'andre').partnerId).toBe('a-ana');
  });
});

describe('identidade e nomes', () => {
  it('usa o nome atual do elenco quando o jogador ainda existe', () => {
    const renamed = roster.map((player) =>
      player.id === 'andre' ? { ...player, name: 'André Atual' } : player
    );
    const index = indexOf(documentOf(doublesSession()), renamed);
    expect(getPlayerPerformance(index, 'andre').playerName).toBe('André Atual');
    expect(getPlayerPartnerPerformance(index, 'ana')[0].partnerName).toBe('André Atual');
  });

  it('usa o snapshot mais recente quando o jogador foi excluído', () => {
    const older = doublesSession({
      id: 'old',
      date: '2026-09-10',
      updatedAt: ISO,
      createdAt: ISO,
      lineupA: [member('ghost', 'Nome Antigo'), member('ana', 'Ana')],
    });
    older.teams[0] = team('t1', [member('ghost', 'Nome Antigo'), member('ana', 'Ana')]);
    const newer = doublesSession({
      id: 'new',
      date: '2026-09-12',
      updatedAt: LATER,
      createdAt: ISO,
      lineupA: [member('ghost', 'Nome Recente'), member('ana', 'Ana')],
    });
    newer.teams[0] = team('t1', [member('ghost', 'Nome Recente'), member('ana', 'Ana')]);
    const index = indexOf(documentOf(older, newer), roster.filter((player) => player.id !== 'ghost'));
    expect(getPlayerPerformance(index, 'ghost').playerName).toBe('Nome Recente');
    expect(getPlayerPartnerPerformance(index, 'ana').some((item) => item.partnerId === 'ghost')).toBe(
      true
    );
    expect(getPlayerPartnerPerformance(index, 'ana').find((item) => item.partnerId === 'ghost').partnerName).toBe(
      'Nome Recente'
    );
  });

  it('desempata snapshot pela data, updatedAt, createdAt e ordem estável', () => {
    const sameDateOlderUpdate = doublesSession({
      id: 'a',
      date: '2026-09-12',
      updatedAt: ISO,
      createdAt: ISO,
      lineupA: [member('ghost', 'Primeiro'), member('ana', 'Ana')],
    });
    sameDateOlderUpdate.teams[0] = team('t1', [member('ghost', 'Primeiro'), member('ana', 'Ana')]);
    const sameDateNewerUpdate = doublesSession({
      id: 'b',
      date: '2026-09-12',
      updatedAt: LATER,
      createdAt: ISO,
      scoreA: 10,
      scoreB: 21,
      lineupA: [member('ghost', 'Segundo'), member('ana', 'Ana')],
    });
    sameDateNewerUpdate.teams[0] = team('t1', [member('ghost', 'Segundo'), member('ana', 'Ana')]);
    const index = indexOf(documentOf(sameDateOlderUpdate, sameDateNewerUpdate), []);
    expect(getPlayerPerformance(index, 'ghost').playerName).toBe('Segundo');
  });

  it('desempata createdAt e, com timestamps iguais, a ordem estável do documento', () => {
    const olderCreated = doublesSession({
      id: 'created-old',
      date: '2026-09-12',
      updatedAt: LATER,
      createdAt: ISO,
      lineupA: [member('ghost', 'Created Antigo'), member('ana', 'Ana')],
    });
    olderCreated.teams[0] = team('t1', [member('ghost', 'Created Antigo'), member('ana', 'Ana')]);
    const newerCreated = doublesSession({
      id: 'created-new',
      date: '2026-09-12',
      updatedAt: LATER,
      createdAt: LATER,
      lineupA: [member('ghost', 'Created Recente'), member('ana', 'Ana')],
    });
    newerCreated.teams[0] = team('t1', [member('ghost', 'Created Recente'), member('ana', 'Ana')]);
    expect(
      getPlayerPerformance(indexOf(documentOf(olderCreated, newerCreated), []), 'ghost').playerName
    ).toBe('Created Recente');

    const first = doublesSession({
      id: 'stable-a',
      date: '2026-09-12',
      updatedAt: ISO,
      createdAt: ISO,
      lineupA: [member('ghost', 'Primeiro estável'), member('ana', 'Ana')],
    });
    first.teams[0] = team('t1', [member('ghost', 'Primeiro estável'), member('ana', 'Ana')]);
    const second = doublesSession({
      id: 'stable-b',
      date: '2026-09-12',
      updatedAt: ISO,
      createdAt: ISO,
      lineupA: [member('ghost', 'Segundo estável'), member('ana', 'Ana')],
    });
    second.teams[0] = team('t1', [member('ghost', 'Segundo estável'), member('ana', 'Ana')]);
    expect(getPlayerPerformance(indexOf(documentOf(first, second), []), 'ghost').playerName).toBe(
      'Segundo estável'
    );
  });

  it('não une jogadores distintos só porque o nome é igual', () => {
    const twins = doublesSession({
      lineupA: [member('andre-1', 'André'), member('ana', 'Ana')],
      lineupB: [member('andre-2', 'André'), member('gabi', 'Gabi')],
    });
    twins.teams = [
      team('t1', [member('andre-1', 'André'), member('ana', 'Ana')]),
      team('t2', [member('andre-2', 'André'), member('gabi', 'Gabi')]),
    ];
    const index = indexOf(documentOf(twins), [
      { id: 'andre-1', name: 'André' },
      { id: 'andre-2', name: 'André' },
      { id: 'ana', name: 'Ana' },
      { id: 'gabi', name: 'Gabi' },
    ]);
    expect(getPlayerPerformance(index, 'andre-1').wins).toBe(1);
    expect(getPlayerPerformance(index, 'andre-2').losses).toBe(1);
    expect(getPlayerPartnerPerformance(index, 'andre-1').map((item) => item.partnerId)).toEqual([
      'ana',
    ]);
  });
});

describe('reconstrução após edição e imutabilidade', () => {
  it('recalcula ao editar placar, lineup ou excluir encontro', () => {
    const original = documentOf(doublesSession());
    const first = indexOf(original);
    expect(getPlayerPerformance(first, 'andre').wins).toBe(1);

    const scored = setTeamSessionMatchScore(original, 'session-2x2', 'session-2x2-r1', 'session-2x2-m1', 10, 21, {
      now: () => new Date(LATER),
    });
    expect(scored.ok).toBe(true);
    const afterScore = indexOf(scored.document);
    expect(getPlayerPerformance(afterScore, 'andre')).toMatchObject({ wins: 0, losses: 1 });
    expect(getPlayerPerformance(first, 'andre').wins).toBe(1);

    const relined = setTeamSessionMatchLineups(
      original,
      'session-2x2',
      'session-2x2-r1',
      'session-2x2-m1',
      ['andre'],
      ['gabi', 'luiza'],
      { roster, now: () => new Date(LATER) }
    );
    expect(relined.ok).toBe(true);
    const afterLineup = indexOf(relined.document);
    expect(getPlayerPartnerPerformance(afterLineup, 'andre')).toEqual([]);
    expect(getPlayerPartnerPerformance(first, 'andre').map((item) => item.partnerId)).toEqual(['ana']);

    const withExtra = documentOf(doublesSession(), doublesSession({ id: 'other', scoreA: 21, scoreB: 10 }));
    const beforeDelete = indexOf(withExtra);
    expect(getPlayerPerformance(beforeDelete, 'andre').matches).toBe(2);
    const deleted = deleteTeamSession(withExtra, 'other', { deleteConfirmed: true });
    expect(deleted.ok).toBe(true);
    expect(getPlayerPerformance(indexOf(deleted.document), 'andre').matches).toBe(1);
  });

  it('não muta a entrada e congela o retorno para não alterar o índice', () => {
    const document = documentOf(doublesSession());
    const documentSnapshot = JSON.parse(JSON.stringify(document));
    const rosterSnapshot = JSON.parse(JSON.stringify(roster));
    const built = buildPlayerPerformanceIndex(document, roster);
    expect(built.ok).toBe(true);
    expect(document).toEqual(documentSnapshot);
    expect(roster).toEqual(rosterSnapshot);

    const performance = getPlayerPerformance(built.index, 'andre');
    const partners = getPlayerPartnerPerformance(built.index, 'andre');
    expect(() => {
      performance.wins = 99;
    }).toThrow();
    expect(() => {
      partners.push({ partnerId: 'x' });
    }).toThrow();
    expect(getPlayerPerformance(built.index, 'andre').wins).toBe(1);
    expect(built.index.players).toBeUndefined();
  });
});

describe('contrato das consultas', () => {
  it('devolve métricas zeradas para jogador desconhecido e null sem parceiro', () => {
    const index = indexOf(documentOf(doublesSession()));
    expect(getPlayerPerformance(index, 'desconhecido')).toMatchObject({
      playerId: 'desconhecido',
      playerName: '',
      matches: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      pointsFor: 0,
      averagePointsFor: 0,
      pointsAgainst: 0,
      averagePointsAgainst: 0,
      pointDifference: 0,
    });
    expect(getPlayerPartnerPerformance(index, 'desconhecido')).toEqual([]);
    expect(getBestPartner(index, 'desconhecido')).toBeNull();
    expect(getBestPartner(index, 'fabio')).toBeNull();
  });

  it('omite filters como lineupSize e partnerId nulos', () => {
    const index = indexOf(documentOf(doublesSession()));
    expect(getPlayerPerformance(index, 'andre')).toEqual(
      getPlayerPerformance(index, 'andre', { lineupSize: null, partnerId: null })
    );
    expect(getPlayerPerformance(index, 'andre', undefined)).toEqual(
      getPlayerPerformance(index, 'andre', null)
    );
    expect(getBestPartner(index, 'andre')).toEqual(getBestPartner(index, 'andre', {}));
  });

  it('rejeita filtros de modalidade e parceiro inválidos', () => {
    const index = indexOf(documentOf(doublesSession()));
    const invalidSizes = [2.5, -1, 0, '2', 7, true];
    for (const lineupSize of invalidSizes) {
      expect(() => getPlayerPerformance(index, 'andre', { lineupSize })).toThrow(TypeError);
      expect(() => getPlayerPerformance(index, 'andre', { lineupSize })).toThrow(
        'O filtro de modalidade é inválido.'
      );
    }
    for (const partnerId of ['', '   ', 0]) {
      expect(() => getPlayerPerformance(index, 'andre', { partnerId })).toThrow(TypeError);
      expect(() => getPlayerPerformance(index, 'andre', { partnerId })).toThrow(
        'O filtro de parceiro é inválido.'
      );
    }
    expect(() => getBestPartner(index, 'andre', [])).toThrow('Os filtros de desempenho são inválidos.');
  });

  it('rejeita índice falso ou produzido por outro objeto', () => {
    const fake = Object.freeze({
      includedMatches: 0,
      skippedPendingMatches: 0,
      skippedInvalidMatches: 0,
    });
    expect(() => getPlayerPerformance(fake, 'andre')).toThrow('O índice de desempenho é inválido.');
    expect(() => getPlayerPartnerPerformance({}, 'andre')).toThrow(
      'O índice de desempenho é inválido.'
    );
  });

  it('congela retornos aninhados para não alterar consultas futuras', () => {
    const index = indexOf(documentOf(doublesSession(), sixesSession()));
    const performance = getPlayerPerformance(index, 'andre');
    const partners = getPlayerPartnerPerformance(index, 'andre');
    expect(() => {
      performance.modalities.push(9);
    }).toThrow();
    expect(() => {
      performance.byLineupSize[0].wins = 99;
    }).toThrow();
    expect(() => {
      partners[0].partnerName = 'Mutado';
    }).toThrow();
    expect(getPlayerPerformance(index, 'andre').modalities).toEqual([2, 6]);
    expect(getPlayerPartnerPerformance(index, 'andre')[0].partnerName).not.toBe('Mutado');
  });
});

describe('cenário realista 2x2 e 6x6 com 6 contra 5', () => {
  it('separa modalidades, parceiros e empréstimo de André', () => {
    const twos = doublesSession();
    const sixAgainstFive = sixesSession({
      lineupA: namesOf(['andre', 'bruno', 'carla', 'diego', 'erika', 'fabio']),
      lineupB: namesOf(['gabi', 'luiza', 'geo', 'ana', 'carla'].slice(0, 5)),
    });
    sixAgainstFive.rounds[0].matches[0].lineupB = namesOf(['gabi', 'luiza', 'geo', 'ana', 'helen']);
    const index = indexOf(documentOf(twos, sixAgainstFive));

    expect(index.includedMatches).toBe(2);
    expect(getPlayerPerformance(index, 'andre').modalities).toEqual([2, 6]);
    expect(getPlayerPerformance(index, 'andre', { lineupSize: 2 })).toMatchObject({
      matches: 1,
      wins: 1,
      pointsFor: 21,
    });
    expect(getPlayerPerformance(index, 'andre', { lineupSize: 6 })).toMatchObject({
      matches: 1,
      wins: 1,
      pointsFor: 25,
    });
    expect(getPlayerPartnerPerformance(index, 'andre', { lineupSize: 2 }).map((item) => item.partnerId)).toEqual([
      'ana',
    ]);
    expect(getPlayerPartnerPerformance(index, 'andre', { lineupSize: 6 }).map((item) => item.partnerId)).toEqual([
      'bruno',
      'carla',
      'diego',
      'erika',
      'fabio',
    ]);
    expect(getPlayerPerformance(index, 'geo', { lineupSize: 5 })).toMatchObject({
      matches: 1,
      losses: 1,
      pointsFor: 22,
    });
    expect(getBestPartner(index, 'andre', { lineupSize: 2 }).partnerId).toBe('ana');
    expect(getBestPartner(index, 'andre', { lineupSize: 6 }).partnerId).toBe('bruno');
  });
});

describe('listPerformancePlayers', () => {
  it('inclui jogadores atuais sem partidas e ordena por nome e ID', () => {
    const listed = listPerformancePlayers(indexOf(documentOf()));
    expect(listed.every((player) => player.matches === 0)).toBe(true);
    expect(listed.every((player) => player.isCurrentRosterPlayer)).toBe(true);
    expect(listed.map((player) => player.playerId)).toEqual([
      'ana',
      'andre',
      'bruno',
      'carla',
      'diego',
      'erika',
      'fabio',
      'gabi',
      'geo',
      'helen',
      'luiza',
    ]);
    expect(listed.find((player) => player.playerId === 'andre').playerName).toBe('André');
    expect(() => {
      listed.push({ playerId: 'x' });
    }).toThrow();
  });

  it('lista jogador histórico excluído com snapshot e não o recria no elenco', () => {
    const older = doublesSession({
      id: 'old',
      date: '2026-09-10',
      lineupA: [member('ghost', 'Nome Antigo'), member('ana', 'Ana')],
    });
    older.teams[0] = team('t1', [member('ghost', 'Nome Antigo'), member('ana', 'Ana')]);
    const newer = doublesSession({
      id: 'new',
      date: '2026-09-12',
      updatedAt: LATER,
      lineupA: [member('ghost', 'Nome Recente'), member('ana', 'Ana')],
    });
    newer.teams[0] = team('t1', [member('ghost', 'Nome Recente'), member('ana', 'Ana')]);
    const currentRoster = roster.filter((player) => player.id !== 'ghost');
    const listed = listPerformancePlayers(indexOf(documentOf(older, newer), currentRoster));
    const ghost = listed.find((player) => player.playerId === 'ghost');
    expect(ghost).toMatchObject({
      playerId: 'ghost',
      playerName: 'Nome Recente',
      isCurrentRosterPlayer: false,
      matches: 2,
    });
    expect(currentRoster.some((player) => player.id === 'ghost')).toBe(false);
  });

  it('mantém IDs diferentes com o mesmo nome como pessoas distintas', () => {
    const twins = doublesSession({
      lineupA: [member('andre-1', 'André'), member('ana', 'Ana')],
      lineupB: [member('andre-2', 'André'), member('gabi', 'Gabi')],
    });
    twins.teams = [
      team('t1', [member('andre-1', 'André'), member('ana', 'Ana')]),
      team('t2', [member('andre-2', 'André'), member('gabi', 'Gabi')]),
    ];
    const listed = listPerformancePlayers(
      indexOf(documentOf(twins), [
        { id: 'andre-1', name: 'André' },
        { id: 'andre-2', name: 'André' },
        { id: 'ana', name: 'Ana' },
        { id: 'gabi', name: 'Gabi' },
      ])
    );
    const andres = listed.filter((player) => player.playerName === 'André');
    expect(andres.map((player) => player.playerId)).toEqual(['andre-1', 'andre-2']);
    expect(andres[0].matches).toBe(1);
    expect(andres[1].matches).toBe(1);
  });
});

function pairingSession({
  id,
  date,
  scoreA,
  scoreB,
  lineupA,
  lineupB,
} = {}) {
  return doublesSession({
    id,
    date,
    name: `Encontro ${id}`,
    scoreA,
    scoreB,
    lineupA,
    lineupB,
    teams: [team('t1', lineupA), team('t2', lineupB)],
  });
}

describe('histórico de partidas', () => {
  const andrePaulo = [member('andre', 'André'), member('paulo', 'Paulo Antigo')];
  const joaoPedro = [member('joao', 'João'), member('pedro', 'Pedro')];
  const andreAna = [member('andre', 'André'), member('ana', 'Ana')];
  const gabiLuiza = [member('gabi', 'Gabi'), member('luiza', 'Luiza')];

  function historyDocument() {
    const pending = pairingSession({
      id: 'pending-day',
      date: '2026-09-02',
      scoreA: null,
      scoreB: null,
      lineupA: andrePaulo,
      lineupB: joaoPedro,
    });
    return documentOf(
      pairingSession({
        id: 'win-day',
        date: '2026-08-31',
        scoreA: 21,
        scoreB: 17,
        lineupA: andrePaulo,
        lineupB: joaoPedro,
      }),
      pairingSession({
        id: 'loss-day',
        date: '2026-09-01',
        scoreA: 15,
        scoreB: 21,
        lineupA: andrePaulo,
        lineupB: joaoPedro,
      }),
      pairingSession({
        id: 'other-partner',
        date: '2026-09-03',
        scoreA: 21,
        scoreB: 10,
        lineupA: andreAna,
        lineupB: gabiLuiza,
      }),
      pending
    );
  }

  const historyRoster = [
    { id: 'andre', name: 'André' },
    { id: 'paulo', name: 'Paulo' },
    { id: 'joao', name: 'João' },
    { id: 'pedro', name: 'Pedro' },
    { id: 'ana', name: 'Ana' },
    { id: 'gabi', name: 'Gabi' },
    { id: 'luiza', name: 'Luiza' },
  ];

  it('separa vitórias e derrotas com adversários, placares e snapshot histórico', () => {
    const index = indexOf(historyDocument(), historyRoster);
    const wins = getPlayerPartnerMatchHistory(index, 'andre', 'paulo', { result: 'win' });
    const losses = getPlayerPartnerMatchHistory(index, 'andre', 'paulo', { result: 'loss' });

    expect(wins).toHaveLength(1);
    expect(wins[0]).toMatchObject({
      sourceType: 'session',
      sourceId: 'win-day',
      sourceName: 'Encontro win-day',
      sessionId: 'win-day',
      sessionName: 'Encontro win-day',
      sessionDate: '2026-08-31',
      roundId: 'win-day-r1',
      roundNumber: 1,
      matchId: 'win-day-m1',
      scoreA: 21,
      scoreB: 17,
      result: 'win',
    });
    expect(wins[0].teammates.map((player) => player.playerName)).toEqual(['André', 'Paulo Antigo']);
    expect(wins[0].partners.map((player) => player.playerName)).toEqual(['Paulo Antigo']);
    expect(wins[0].opponents.map((player) => player.playerId)).toEqual(['joao', 'pedro']);
    expect(wins[0].opponents.map((player) => player.playerName)).toEqual(['João', 'Pedro']);

    expect(losses).toHaveLength(1);
    expect(losses[0]).toMatchObject({
      sessionId: 'loss-day',
      sessionDate: '2026-09-01',
      scoreA: 15,
      scoreB: 21,
      result: 'loss',
      pointsFor: 15,
      pointsAgainst: 21,
    });
    expect(getPlayerMatchHistory(index, 'andre', { partnerId: 'paulo' })).toHaveLength(2);
    expect(getPlayerMatchHistory(index, 'andre')).toHaveLength(3);
  });

  it('não inclui partida pendente no histórico nem nas estatísticas', () => {
    const index = indexOf(historyDocument(), historyRoster);
    expect(index).toMatchObject({
      includedMatches: 3,
      skippedPendingMatches: 1,
    });
    expect(getPlayerMatchHistory(index, 'andre').map((item) => item.sessionId)).not.toContain(
      'pending-day'
    );
    expect(getPlayerPerformance(index, 'andre').matches).toBe(3);
    expect(getPlayerPerformance(index, 'andre', { partnerId: 'paulo' })).toMatchObject({
      matches: 2,
      wins: 1,
      losses: 1,
    });
  });

  it('filtra histórico por data inicial, final e intervalo', () => {
    const index = indexOf(historyDocument(), historyRoster);
    expect(
      getPlayerMatchHistory(index, 'andre', { startDate: '2026-09-01' }).map((item) => item.sessionDate)
    ).toEqual(['2026-09-01', '2026-09-03']);
    expect(
      getPlayerMatchHistory(index, 'andre', { endDate: '2026-08-31' }).map((item) => item.sessionDate)
    ).toEqual(['2026-08-31']);
    expect(
      getPlayerMatchHistory(index, 'andre', {
        startDate: '2026-08-31',
        endDate: '2026-09-01',
      }).map((item) => item.sessionId)
    ).toEqual(['win-day', 'loss-day']);
  });
});

describe('ranking de jogadores', () => {
  function rankedSession(id, date, lineupA, lineupB, scoreA, scoreB) {
    return pairingSession({ id, date, lineupA, lineupB, scoreA, scoreB });
  }

  const andre = [member('andre', 'André'), member('ana', 'Ana')];
  const bruno = [member('bruno', 'Bruno'), member('carla', 'Carla')];
  const diego = [member('diego', 'Diego'), member('erika', 'Erika')];

  function rankingDocument() {
    return documentOf(
      rankedSession('early-win', '2026-08-30', andre, bruno, 21, 10),
      rankedSession('mid-win', '2026-09-01', andre, diego, 21, 18),
      rankedSession('mid-loss', '2026-09-01', bruno, diego, 8, 21),
      rankedSession('late-win', '2026-09-05', bruno, andre, 21, 15),
      rankedSession('pending', '2026-09-06', andre, bruno, null, null)
    );
  }

  it('filtra por data e não conta partida pendente', () => {
    const index = indexOf(rankingDocument());
    expect(index.skippedPendingMatches).toBe(1);
    const fromStart = getPlayerPerformanceRanking(index, {
      startDate: '2026-09-01',
      playerIds: ['andre', 'bruno', 'diego'],
      sortBy: 'wins',
      sortDirection: 'desc',
    });
    expect(fromStart.map((row) => [row.playerId, row.matches, row.wins])).toEqual([
      ['diego', 2, 1],
      ['andre', 2, 1],
      ['bruno', 2, 1],
    ]);

    const untilEnd = getPlayerPerformanceRanking(index, {
      endDate: '2026-08-30',
      playerIds: ['andre', 'bruno'],
      sortBy: 'wins',
    });
    expect(untilEnd.map((row) => [row.playerId, row.matches, row.wins, row.losses])).toEqual([
      ['andre', 1, 1, 0],
      ['bruno', 1, 0, 1],
    ]);

    const range = getPlayerPerformanceRanking(index, {
      startDate: '2026-08-30',
      endDate: '2026-09-01',
      playerIds: ['andre', 'bruno', 'diego'],
      sortBy: 'wins',
    });
    expect(range.find((row) => row.playerId === 'andre')).toMatchObject({
      matches: 2,
      wins: 2,
    });
    expect(range.find((row) => row.playerId === 'bruno').matches).toBe(2);
  });

  it('limita o ranking ao subconjunto, mas conta jogos contra quem ficou de fora', () => {
    const index = indexOf(rankingDocument());
    const subset = getPlayerPerformanceRanking(index, {
      playerIds: ['andre', 'bruno'],
      sortBy: 'wins',
    });
    expect(subset.map((row) => row.playerId)).toEqual(['andre', 'bruno']);
    expect(subset.find((row) => row.playerId === 'andre').matches).toBe(3);
    expect(subset.find((row) => row.playerId === 'bruno').matches).toBe(3);
    expect(subset.some((row) => row.playerId === 'diego')).toBe(false);
  });

  it('ordena por vitórias, aproveitamento e saldo com desempate determinístico', () => {
    const index = indexOf(rankingDocument());
    const byWins = getPlayerPerformanceRanking(index, {
      playerIds: ['andre', 'bruno', 'diego'],
      sortBy: 'wins',
      sortDirection: 'desc',
    });
    expect(byWins.map((row) => row.playerId)).toEqual(['andre', 'bruno', 'diego']);
    expect(byWins[0]).toMatchObject({ playerId: 'andre', wins: 2, losses: 1 });

    const byWinRate = getPlayerPerformanceRanking(index, {
      playerIds: ['andre', 'bruno', 'diego'],
      sortBy: 'winRate',
      sortDirection: 'desc',
    });
    expect(byWinRate[0].playerId).toBe('andre');
    expect(byWinRate[0].winRate).toBeCloseTo(2 / 3);

    const byDiff = getPlayerPerformanceRanking(index, {
      playerIds: ['andre', 'bruno', 'diego'],
      sortBy: 'pointDifference',
      sortDirection: 'desc',
    });
    expect(byDiff.map((row) => row.playerId)).toEqual(['diego', 'andre', 'bruno']);

    const tied = getPlayerPerformanceRanking(index, {
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      playerIds: ['andre', 'bruno', 'diego'],
      sortBy: 'wins',
      sortDirection: 'desc',
    });
    expect(tied.map((row) => [row.playerId, row.wins, row.matches])).toEqual([
      ['diego', 1, 2],
      ['andre', 1, 1],
      ['bruno', 0, 1],
    ]);
    expect(RANKING_SORT_FIELDS).toEqual([
      'name',
      'matches',
      'wins',
      'losses',
      'winRate',
      'pointsFor',
      'averagePointsFor',
      'pointsAgainst',
      'averagePointsAgainst',
      'pointDifference',
    ]);
  });

  it('calcula médias de pontos a partir das estatísticas do recorte', () => {
    const index = indexOf(
      documentOf(
        rankedSession('g1', '2026-09-10', andre, bruno, 21, 15),
        rankedSession('g2', '2026-09-11', andre, diego, 21, 18),
        rankedSession('g3', '2026-09-12', andre, bruno, 18, 16),
        rankedSession('g4', '2026-09-13', andre, diego, 18, 16)
      )
    );
    const [andreRow] = getPlayerPerformanceRanking(index, {
      playerIds: ['andre'],
    });
    expect(andreRow).toMatchObject({
      matches: 4,
      pointsFor: 78,
      pointsAgainst: 65,
      averagePointsFor: 19.5,
      averagePointsAgainst: 16.25,
    });
    expect(Number.isFinite(andreRow.averagePointsFor)).toBe(true);
    expect(Number.isFinite(andreRow.averagePointsAgainst)).toBe(true);
  });

  it('zera as médias quando o jogador não tem partidas no recorte', () => {
    const index = indexOf(rankingDocument());
    const [fabio] = getPlayerPerformanceRanking(index, {
      playerIds: ['fabio'],
    });
    expect(fabio).toMatchObject({
      playerId: 'fabio',
      matches: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      averagePointsFor: 0,
      averagePointsAgainst: 0,
    });
    expect(Object.is(fabio.averagePointsFor, 0)).toBe(true);
    expect(Object.is(fabio.averagePointsAgainst, 0)).toBe(true);
  });

  it('recalcula as médias com o mesmo recorte de datas do ranking', () => {
    const index = indexOf(rankingDocument());
    const untilEnd = getPlayerPerformanceRanking(index, {
      endDate: '2026-08-30',
      playerIds: ['andre', 'bruno'],
    });
    expect(untilEnd.find((row) => row.playerId === 'andre')).toMatchObject({
      matches: 1,
      pointsFor: 21,
      pointsAgainst: 10,
      averagePointsFor: 21,
      averagePointsAgainst: 10,
    });

    const fromStart = getPlayerPerformanceRanking(index, {
      startDate: '2026-09-01',
      playerIds: ['andre'],
    });
    expect(fromStart[0]).toMatchObject({
      matches: 2,
      pointsFor: 36,
      pointsAgainst: 39,
      averagePointsFor: 18,
      averagePointsAgainst: 19.5,
    });

    const range = getPlayerPerformanceRanking(index, {
      startDate: '2026-08-30',
      endDate: '2026-09-01',
      playerIds: ['andre'],
    });
    expect(range[0]).toMatchObject({
      matches: 2,
      pointsFor: 42,
      pointsAgainst: 28,
      averagePointsFor: 21,
      averagePointsAgainst: 14,
    });
  });

  it('ordena por média de pontos feitos e sofridos nos dois sentidos', () => {
    const index = indexOf(rankingDocument());
    const ids = ['andre', 'bruno', 'diego'];

    const forDesc = getPlayerPerformanceRanking(index, {
      playerIds: ids,
      sortBy: 'averagePointsFor',
      sortDirection: 'desc',
    });
    expect(forDesc.map((row) => [row.playerId, row.averagePointsFor])).toEqual([
      ['diego', 19.5],
      ['andre', 19],
      ['bruno', 13],
    ]);

    const forAsc = getPlayerPerformanceRanking(index, {
      playerIds: ids,
      sortBy: 'averagePointsFor',
      sortDirection: 'asc',
    });
    expect(forAsc.map((row) => row.playerId)).toEqual(['bruno', 'andre', 'diego']);

    const againstDesc = getPlayerPerformanceRanking(index, {
      playerIds: ids,
      sortBy: 'averagePointsAgainst',
      sortDirection: 'desc',
    });
    expect(againstDesc.map((row) => [row.playerId, row.averagePointsAgainst])).toEqual([
      ['bruno', 19],
      ['andre', 49 / 3],
      ['diego', 14.5],
    ]);

    const againstAsc = getPlayerPerformanceRanking(index, {
      playerIds: ids,
      sortBy: 'averagePointsAgainst',
      sortDirection: 'asc',
    });
    expect(againstAsc.map((row) => row.playerId)).toEqual(['diego', 'andre', 'bruno']);
  });

  it('desempata médias iguais de forma determinística', () => {
    const index = indexOf(
      documentOf(
        rankedSession('a-win', '2026-09-10', andre, diego, 21, 18),
        rankedSession('b-win', '2026-09-10', bruno, diego, 21, 18)
      )
    );
    const desc = getPlayerPerformanceRanking(index, {
      playerIds: ['andre', 'bruno'],
      sortBy: 'averagePointsFor',
      sortDirection: 'desc',
    });
    const asc = getPlayerPerformanceRanking(index, {
      playerIds: ['andre', 'bruno'],
      sortBy: 'averagePointsFor',
      sortDirection: 'asc',
    });
    expect(desc.map((row) => row.playerId)).toEqual(['andre', 'bruno']);
    expect(asc.map((row) => row.playerId)).toEqual(['andre', 'bruno']);
    expect(desc[0].averagePointsFor).toBe(21);
    expect(desc[1].averagePointsFor).toBe(21);
  });

  it('compara médias com precisão completa, sem arredondar antes da ordenação', () => {
    const anaLine = [member('ana', 'Ana'), member('carla', 'Carla')];
    const brunoLine = [member('bruno', 'Bruno'), member('diego', 'Diego')];
    const oppA = [member('erika', 'Erika'), member('fabio', 'Fábio')];
    const oppB = [member('gabi', 'Gabi'), member('luiza', 'Luiza')];
    const index = indexOf(
      documentOf(
        rankedSession('ana-1', '2026-09-10', anaLine, oppA, 21, 10),
        rankedSession('ana-2', '2026-09-11', anaLine, oppB, 21, 10),
        rankedSession('ana-3', '2026-09-12', anaLine, oppA, 19, 18),
        rankedSession('bruno-1', '2026-09-10', brunoLine, oppB, 21, 10),
        rankedSession('bruno-2', '2026-09-11', brunoLine, oppA, 21, 10),
        rankedSession('bruno-3', '2026-09-12', brunoLine, oppB, 21, 10),
        rankedSession('bruno-4', '2026-09-13', brunoLine, oppA, 18, 16)
      )
    );
    const anaAvg = 61 / 3;
    const brunoAvg = 81 / 4;
    expect(anaAvg).toBeGreaterThan(brunoAvg);
    expect(Math.round(anaAvg * 10) / 10).toBe(Math.round(brunoAvg * 10) / 10);

    const desc = getPlayerPerformanceRanking(index, {
      playerIds: ['ana', 'bruno'],
      sortBy: 'averagePointsFor',
      sortDirection: 'desc',
    });
    expect(desc.map((row) => row.playerId)).toEqual(['ana', 'bruno']);
    expect(desc[0].averagePointsFor).toBe(anaAvg);
    expect(desc[1].averagePointsFor).toBe(brunoAvg);

    const asc = getPlayerPerformanceRanking(index, {
      playerIds: ['ana', 'bruno'],
      sortBy: 'averagePointsFor',
      sortDirection: 'asc',
    });
    expect(asc.map((row) => row.playerId)).toEqual(['bruno', 'ana']);
  });
});

describe('lookup compacto de parcerias', () => {
  const andrePaulo = [member('andre', 'André'), member('paulo', 'Paulo')];
  const joaoPedro = [member('joao', 'João'), member('pedro', 'Pedro')];
  const andreAna = [member('andre', 'André'), member('ana', 'Ana')];
  const gabiLuiza = [member('gabi', 'Gabi'), member('luiza', 'Luiza')];

  function lookupDocument() {
    return documentOf(
      pairingSession({
        id: 'win-day',
        date: '2026-08-31',
        scoreA: 21,
        scoreB: 17,
        lineupA: andrePaulo,
        lineupB: joaoPedro,
      }),
      pairingSession({
        id: 'loss-day',
        date: '2026-09-01',
        scoreA: 15,
        scoreB: 21,
        lineupA: andrePaulo,
        lineupB: joaoPedro,
      }),
      pairingSession({
        id: 'pending-day',
        date: '2026-09-02',
        scoreA: null,
        scoreB: null,
        lineupA: andrePaulo,
        lineupB: joaoPedro,
      }),
      pairingSession({
        id: 'other-partner',
        date: '2026-09-03',
        scoreA: 21,
        scoreB: 10,
        lineupA: andreAna,
        lineupB: gabiLuiza,
      })
    );
  }

  it('conta só partidas concluídas e não muta o índice', () => {
    const document = lookupDocument();
    const index = indexOf(document, roster);
    const andrePauloBefore = getPlayerPartnerPerformance(index, 'andre', { partnerId: 'paulo' });
    const lookup = buildPartnershipRepeatLookup(index);

    expect(lookup.count('andre', 'paulo')).toBe(2);
    expect(lookup.count('paulo', 'andre')).toBe(2);
    expect(lookup.count('andre', 'ana')).toBe(1);
    expect(lookup.count('andre', 'pedro')).toBe(0);
    expect(lookup.count('andre', 'andre')).toBe(0);

    const scoped = buildPartnershipRepeatLookup(index, ['andre', 'paulo', 'ana']);
    expect(scoped.count('andre', 'paulo')).toBe(2);
    expect(scoped.count('andre', 'ana')).toBe(1);
    expect(scoped.count('joao', 'pedro')).toBe(0);

    expect(getPlayerPartnerPerformance(index, 'andre', { partnerId: 'paulo' })).toEqual(andrePauloBefore);
    expect(index.includedMatches).toBe(3);
    expect(index.skippedPendingMatches).toBe(1);
  });
});

function sequentialIds(prefix) {
  let count = 0;
  return () => `${prefix}-${(count += 1)}`;
}

function competitionsOf(...competitions) {
  return { schemaVersion: 2, competitions };
}

function draftCompetitionWithTeams({
  idPrefix = 'comp',
  name = 'Clash de Sexta',
  date = '2026-09-10',
  teams,
} = {}) {
  const ids = sequentialIds(idPrefix);
  const draft = createDraftCompetition(
    { name, date, format: { teamSize: 2 } },
    { idGenerator: ids, now: () => new Date('2026-09-10T12:00:00.000Z') }
  );
  const withTeams = setDraftCompetitionTeams(draft, teams, { idGenerator: ids });
  expect(withTeams.ok).toBe(true);
  const generated = generateCompetitionBracket(withTeams.competition, { idGenerator: ids });
  expect(generated.ok).toBe(true);
  return generated.competition;
}

function playCompetitionMatch(competition, matchId, scoreA, scoreB, playedDate) {
  const result = applyCompetitionMatchResult(competition, matchId, {
    scoreA,
    scoreB,
    playedDate,
  });
  expect(result.ok).toBe(true);
  return result.competition;
}

function twoTeamCompetition({
  name = 'Clash de Sexta',
  date = '2026-09-10',
  playedDate = '2026-09-18',
  lineupA = namesOf(['andre', 'ana']),
  lineupB = namesOf(['bruno', 'carla']),
  scoreA = 21,
  scoreB = 15,
  play = true,
  idPrefix = 'clash',
} = {}) {
  const generated = draftCompetitionWithTeams({
    idPrefix,
    name,
    date,
    teams: [
      { id: `${idPrefix}-alpha`, members: lineupA },
      { id: `${idPrefix}-beta`, members: lineupB },
    ],
  });
  if (!play) return generated;
  const match = listCompetitionMatches(generated)[0];
  return playCompetitionMatch(generated, match.id, scoreA, scoreB, playedDate);
}

function threeTeamCompetition({ playSemi = false, semiPlayedDate = '2026-09-18' } = {}) {
  const generated = draftCompetitionWithTeams({
    idPrefix: 'bye',
    name: 'Open com BYE',
    teams: [
      { id: 'bye-seed', members: namesOf(['diego', 'erika']) },
      { id: 'bye-sf-a', members: namesOf(['andre', 'ana']) },
      { id: 'bye-sf-b', members: namesOf(['bruno', 'carla']) },
    ],
  });
  if (!playSemi) return generated;
  const semi = listCompetitionRounds(generated)[0].matches[0];
  return playCompetitionMatch(generated, semi.id, 21, 12, semiPlayedDate);
}

function fourTeamStagedCompetition() {
  const generated = draftCompetitionWithTeams({
    idPrefix: 'open',
    name: 'Open de Setembro',
    date: '2026-09-10',
    teams: [
      { id: 'seed-1', members: namesOf(['andre', 'ana']) },
      { id: 'seed-2', members: namesOf(['bruno', 'carla']) },
      { id: 'seed-3', members: namesOf(['diego', 'erika']) },
      { id: 'seed-4', members: namesOf(['fabio', 'gabi']) },
    ],
  });
  const [sf1, sf2] = listCompetitionRounds(generated)[0].matches;
  const afterSf1 = playCompetitionMatch(generated, sf1.id, 21, 10, '2026-09-18');
  const afterSf2 = playCompetitionMatch(afterSf1, sf2.id, 21, 18, '2026-09-18');
  const final = listCompetitionRounds(afterSf2)[1].matches[0];
  return playCompetitionMatch(afterSf2, final.id, 21, 19, '2026-09-21');
}

describe('desempenho com partidas de competição', () => {
  const emptySessions = documentOf();

  it('omite competições quando o terceiro argumento não é passado', () => {
    const sessions = documentOf(doublesSession());
    const competitions = competitionsOf(twoTeamCompetition());
    const without = buildPlayerPerformanceIndex(sessions, roster);
    const withEmpty = buildPlayerPerformanceIndex(sessions, roster, {
      competitionsDocument: createEmptyCompetitionDocument(),
    });
    const withCompetitions = buildPlayerPerformanceIndex(sessions, roster, {
      competitionsDocument: competitions,
    });

    expect(without.ok).toBe(true);
    expect(withEmpty.ok).toBe(true);
    expect(without.index.includedMatches).toBe(1);
    expect(withEmpty.index.includedMatches).toBe(1);
    expect(withCompetitions.index.includedMatches).toBe(2);
    expect(getPlayerPerformance(without.index, 'andre').matches).toBe(1);
    expect(getPlayerPerformance(withCompetitions.index, 'andre').matches).toBe(2);
  });

  it('agrega uma partida isolada de competição com vitória, derrota, pontos, médias, saldo e parceiros', () => {
    const index = indexOf(emptySessions, roster, {
      competitionsDocument: competitionsOf(twoTeamCompetition()),
    });
    expect(index).toMatchObject({
      includedMatches: 1,
      skippedPendingMatches: 0,
      skippedInvalidMatches: 0,
    });

    expect(getPlayerPerformance(index, 'andre')).toMatchObject({
      matches: 1,
      wins: 1,
      losses: 0,
      winRate: 1,
      pointsFor: 21,
      averagePointsFor: 21,
      pointsAgainst: 15,
      averagePointsAgainst: 15,
      pointDifference: 6,
    });
    expect(getPlayerPerformance(index, 'bruno')).toMatchObject({
      matches: 1,
      wins: 0,
      losses: 1,
      winRate: 0,
      pointsFor: 15,
      averagePointsFor: 15,
      pointsAgainst: 21,
      averagePointsAgainst: 21,
      pointDifference: -6,
    });
    expect(getPlayerPartnerPerformance(index, 'andre').map((item) => item.partnerId)).toEqual(['ana']);
    expect(getPlayerPerformance(index, 'andre', { partnerId: 'ana' })).toMatchObject({
      matches: 1,
      wins: 1,
      pointsFor: 21,
      pointsAgainst: 15,
    });
    expect(getBestPartner(index, 'andre').partnerId).toBe('ana');
  });

  it('combina encontro e competição sem duplicar a mesma partida', () => {
    const sessions = documentOf(
      doublesSession({
        name: 'Sábado na Arena',
        scoreA: 21,
        scoreB: 18,
      })
    );
    const competitions = competitionsOf(twoTeamCompetition());
    const index = indexOf(sessions, roster, { competitionsDocument: competitions });
    expect(index.includedMatches).toBe(2);

    const history = getPlayerMatchHistory(index, 'andre');
    expect(history).toHaveLength(2);
    expect(history.map((item) => item.sourceType).sort()).toEqual([
      MATCH_SOURCE_COMPETITION,
      MATCH_SOURCE_SESSION,
    ]);
    expect(new Set(history.map((item) => `${item.sourceType}:${item.sourceId}:${item.matchId}`)).size).toBe(
      2
    );
    expect(sessions.sessions).toHaveLength(1);
    expect(competitions.competitions).toHaveLength(1);

    expect(getPlayerPerformance(index, 'andre')).toMatchObject({
      matches: 2,
      wins: 2,
      losses: 0,
      pointsFor: 42,
      averagePointsFor: 21,
      pointsAgainst: 33,
      averagePointsAgainst: 16.5,
      pointDifference: 9,
    });
    expect(getPlayerPerformance(index, 'andre', { partnerId: 'ana' })).toMatchObject({
      matches: 2,
      wins: 2,
    });
  });

  it('identifica a origem no histórico detalhado e preserva o snapshot dos nomes', () => {
    const sessions = documentOf(
      doublesSession({
        name: 'Sábado na Arena',
        lineupA: [member('andre', 'André do Encontro'), member('ana', 'Ana')],
      })
    );
    const competitions = competitionsOf(
      twoTeamCompetition({
        lineupA: [member('andre', 'André da Competição'), member('ana', 'Ana')],
      })
    );
    const index = indexOf(sessions, roster, { competitionsDocument: competitions });
    const history = getPlayerMatchHistory(index, 'andre');
    const sessionMatch = history.find((item) => item.sourceType === MATCH_SOURCE_SESSION);
    const competitionMatch = history.find((item) => item.sourceType === MATCH_SOURCE_COMPETITION);

    expect(sessionMatch).toMatchObject({
      sourceType: MATCH_SOURCE_SESSION,
      sourceId: 'session-2x2',
      sourceName: 'Sábado na Arena',
      sessionDate: '2026-09-12',
      roundLabel: null,
    });
    expect(sessionMatch.teammates.map((player) => player.playerName)).toEqual(['André do Encontro', 'Ana']);

    expect(competitionMatch).toMatchObject({
      sourceType: MATCH_SOURCE_COMPETITION,
      sourceName: 'Clash de Sexta',
      sessionDate: '2026-09-18',
      roundLabel: 'Final',
    });
    expect(competitionMatch.sourceId).toBeTruthy();
    expect(competitionMatch.teammates.map((player) => player.playerName)).toEqual([
      'André da Competição',
      'Ana',
    ]);
    expect(Object.isFrozen(competitionMatch)).toBe(true);
  });

  it('filtra o ranking pela playedDate da partida, não pela data inicial da competição', () => {
    const index = indexOf(emptySessions, roster, {
      competitionsDocument: competitionsOf(fourTeamStagedCompetition()),
    });
    expect(index.includedMatches).toBe(3);

    const fromTwentieth = getPlayerPerformanceRanking(index, {
      startDate: '2026-09-20',
      playerIds: ['andre', 'bruno', 'fabio'],
      sortBy: 'wins',
    });
    expect(fromTwentieth.find((row) => row.playerId === 'andre')).toMatchObject({
      matches: 1,
      wins: 1,
      pointsFor: 21,
      pointsAgainst: 19,
    });
    expect(fromTwentieth.find((row) => row.playerId === 'bruno')).toMatchObject({
      matches: 1,
      wins: 0,
      losses: 1,
    });
    expect(fromTwentieth.find((row) => row.playerId === 'fabio')).toMatchObject({
      matches: 0,
      wins: 0,
    });

    const onlyEighteenth = getPlayerPerformanceRanking(index, {
      startDate: '2026-09-18',
      endDate: '2026-09-18',
      playerIds: ['andre'],
      sortBy: 'wins',
    });
    expect(onlyEighteenth[0]).toMatchObject({
      matches: 1,
      wins: 1,
      pointsFor: 21,
      pointsAgainst: 10,
    });
  });

  it('filtra ranking e histórico apenas por encontros ou apenas por competições', () => {
    const sessions = documentOf(doublesSession({ name: 'Sábado na Arena' }));
    const index = indexOf(sessions, roster, {
      competitionsDocument: competitionsOf(twoTeamCompetition()),
    });

    const all = getPlayerPerformanceRanking(index, { playerIds: ['andre'], sortBy: 'wins' });
    const sessionsOnly = getPlayerPerformanceRanking(index, {
      playerIds: ['andre'],
      sourceType: MATCH_SOURCE_SESSION,
      sortBy: 'wins',
    });
    const competitionsOnly = getPlayerPerformanceRanking(index, {
      playerIds: ['andre'],
      sourceType: MATCH_SOURCE_COMPETITION,
      sortBy: 'wins',
    });

    expect(all[0].matches).toBe(2);
    expect(sessionsOnly[0]).toMatchObject({ matches: 1, pointsFor: 21, pointsAgainst: 18 });
    expect(competitionsOnly[0]).toMatchObject({ matches: 1, pointsFor: 21, pointsAgainst: 15 });

    expect(getPlayerMatchHistory(index, 'andre', { sourceType: MATCH_SOURCE_SESSION })).toHaveLength(1);
    expect(getPlayerMatchHistory(index, 'andre', { sourceType: MATCH_SOURCE_COMPETITION })[0]).toMatchObject({
      sourceType: MATCH_SOURCE_COMPETITION,
      sourceName: 'Clash de Sexta',
    });
    expect(() => getPlayerPerformanceRanking(index, { sourceType: 'gist' })).toThrow(
      /filtro de origem é inválido/
    );
  });

  it('ignora BYE e partida pendente de competição', () => {
    const pending = indexOf(emptySessions, roster, {
      competitionsDocument: competitionsOf(twoTeamCompetition({ play: false })),
    });
    expect(pending).toMatchObject({
      includedMatches: 0,
      skippedPendingMatches: 1,
      skippedInvalidMatches: 0,
    });
    expect(getPlayerPerformance(pending, 'andre').matches).toBe(0);
    expect(getPlayerMatchHistory(pending, 'andre')).toEqual([]);

    const withBye = indexOf(emptySessions, roster, {
      competitionsDocument: competitionsOf(threeTeamCompetition({ playSemi: true })),
    });
    expect(listCompetitionMatches(threeTeamCompetition()).length).toBe(2);
    expect(withBye).toMatchObject({
      includedMatches: 1,
      skippedPendingMatches: 1,
      skippedInvalidMatches: 0,
    });
    expect(getPlayerPerformance(withBye, 'andre')).toMatchObject({ matches: 1, wins: 1, pointsFor: 21 });
    expect(getPlayerPerformance(withBye, 'diego').matches).toBe(0);
  });

  it('diagnostica placar inválido de competição com as mesmas regras de encontro', () => {
    const generated = twoTeamCompetition({ play: false });
    const invalid = cloneCompetition(generated);
    invalid.stages[0].rounds[0].matches[0].scoreA = 21;
    invalid.stages[0].rounds[0].matches[0].scoreB = 21;
    invalid.stages[0].rounds[0].matches[0].playedDate = '2026-09-18';

    const result = buildPlayerPerformanceIndex(emptySessions, roster, {
      competitionsDocument: competitionsOf(invalid),
    });
    expect(result.ok).toBe(true);
    expect(result.index).toMatchObject({
      includedMatches: 0,
      skippedPendingMatches: 0,
      skippedInvalidMatches: 1,
    });
  });

  it('rejeita competição estruturalmente inválida sem agregado parcial', () => {
    const result = buildPlayerPerformanceIndex(documentOf(doublesSession()), roster, {
      competitionsDocument: { schemaVersion: 9, competitions: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.index).toBeNull();
    expect(result.errors[0].code).toBe('SCHEMA_VERSION_UNSUPPORTED');
  });
});
