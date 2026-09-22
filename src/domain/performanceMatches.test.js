import { describe, expect, it } from 'vitest';
import { TEAM_SESSION_SCHEMA_VERSION } from './teamSession.js';
import {
  ANALYZABLE_MATCH_INCLUDED,
  ANALYZABLE_MATCH_INVALID,
  ANALYZABLE_MATCH_PENDING,
  MATCH_SOURCE_COMPETITION,
  MATCH_SOURCE_SESSION,
  classifyPerformanceMatch,
  combinePerformanceMatchSources,
  createAnalyzableMatch,
  dedupePerformanceMatchesByOrigin,
  listCompetitionPerformanceMatches,
  listSessionPerformanceMatches,
} from './performanceMatches.js';
import {
  applyCompetitionMatchResult,
  createDraftCompetition,
  generateCompetitionBracket,
  setDraftCompetitionTeams,
} from './competition.js';

const ISO = '2026-09-12T18:00:00.000Z';

function member(playerId, playerName) {
  return { playerId, playerName };
}

function sequentialIds(prefix) {
  let count = 0;
  return () => `${prefix}-${(count += 1)}`;
}

describe('adaptadores de partidas analisáveis', () => {
  it('usa a data do encontro nas partidas de sessão', () => {
    const document = {
      schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
      sessions: [
        {
          id: 'sess-1',
          date: '2026-09-12',
          name: 'Sábado na Arena',
          createdAt: ISO,
          updatedAt: ISO,
          rounds: [
            {
              id: 'r1',
              number: 1,
              name: 'Rodada 1',
              matches: [
                {
                  id: 'm1',
                  lineupA: [member('andre', 'André'), member('ana', 'Ana')],
                  lineupB: [member('bruno', 'Bruno'), member('carla', 'Carla')],
                  scoreA: 21,
                  scoreB: 18,
                },
              ],
            },
          ],
        },
      ],
    };

    const listed = listSessionPerformanceMatches(document);
    expect(listed.matches).toHaveLength(1);
    expect(listed.matches[0]).toMatchObject({
      status: ANALYZABLE_MATCH_INCLUDED,
      sourceType: MATCH_SOURCE_SESSION,
      sourceId: 'sess-1',
      sourceName: 'Sábado na Arena',
      date: '2026-09-12',
      matchId: 'm1',
      roundLabel: 'Rodada 1',
      scoreA: 21,
      scoreB: 18,
    });
  });

  it('usa playedDate nas partidas de competição e não lista BYE', () => {
    const ids = sequentialIds('open');
    const draft = createDraftCompetition(
      { name: 'Open com BYE', date: '2026-09-10', format: { teamSize: 2 } },
      { idGenerator: ids, now: () => new Date(ISO) }
    );
    const withTeams = setDraftCompetitionTeams(
      draft,
      [
        { id: 't1', members: [member('diego', 'Diego'), member('erika', 'Erika')] },
        { id: 't2', members: [member('andre', 'André'), member('ana', 'Ana')] },
        { id: 't3', members: [member('bruno', 'Bruno'), member('carla', 'Carla')] },
      ],
      { idGenerator: ids }
    );
    const generated = generateCompetitionBracket(withTeams.competition, { idGenerator: ids });
    expect(generated.ok).toBe(true);
    const semi = generated.competition.stages[0].rounds[0].matches[0];
    const played = applyCompetitionMatchResult(generated.competition, semi.id, {
      scoreA: 21,
      scoreB: 12,
      playedDate: '2026-09-18',
    });
    expect(played.ok).toBe(true);

    const listed = listCompetitionPerformanceMatches({
      schemaVersion: 2,
      competitions: [played.competition],
    });
    expect(listed.matches).toHaveLength(2);
    expect(listed.matches.map((match) => match.status).sort()).toEqual([
      ANALYZABLE_MATCH_INCLUDED,
      ANALYZABLE_MATCH_PENDING,
    ]);
    const included = listed.matches.find((match) => match.status === ANALYZABLE_MATCH_INCLUDED);
    expect(included).toMatchObject({
      sourceType: MATCH_SOURCE_COMPETITION,
      sourceName: 'Open com BYE',
      date: '2026-09-18',
      roundLabel: 'Semifinal',
      scoreA: 21,
      scoreB: 12,
    });
    expect(included.date).not.toBe('2026-09-10');
  });

  it('classifica pendente e placar inválido sem misturar as origens', () => {
    const sessions = listSessionPerformanceMatches({
      schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
      sessions: [
        {
          id: 'sess-pending',
          date: '2026-09-12',
          name: 'Pendente',
          rounds: [
            {
              id: 'r1',
              number: 1,
              matches: [
                { id: 'pending', lineupA: [], lineupB: [], scoreA: null, scoreB: null },
                { id: 'tie', lineupA: [], lineupB: [], scoreA: 21, scoreB: 21 },
              ],
            },
          ],
        },
      ],
    });
    expect(sessions.matches.map((match) => match.status)).toEqual([
      ANALYZABLE_MATCH_PENDING,
      ANALYZABLE_MATCH_INVALID,
    ]);

    const combined = combinePerformanceMatchSources(
      {
        schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
        sessions: [
          {
            id: 'sess-1',
            date: '2026-09-12',
            name: 'Arena',
            rounds: [
              {
                id: 'r1',
                number: 1,
                matches: [{ id: 'sm1', scoreA: 21, scoreB: 18, lineupA: [], lineupB: [] }],
              },
            ],
          },
        ],
      },
      null
    );
    expect(combined.matches).toHaveLength(1);
    expect(combined.matches[0].sourceType).toBe(MATCH_SOURCE_SESSION);
  });

  it('não transforma BYE suíço em partida analisável', () => {
    const ids = sequentialIds('swiss-bye');
    const draft = createDraftCompetition(
      {
        name: 'Suíço ímpar',
        date: '2026-09-10',
        format: { teamSize: 2 },
        stages: [{ type: 'swiss', config: { roundCount: 1 } }],
      },
      { idGenerator: ids, now: () => new Date(ISO) }
    );
    const withTeams = setDraftCompetitionTeams(
      draft,
      [
        { id: 't1', members: [member('diego', 'Diego'), member('erika', 'Erika')] },
        { id: 't2', members: [member('andre', 'André'), member('ana', 'Ana')] },
        { id: 't3', members: [member('bruno', 'Bruno'), member('carla', 'Carla')] },
      ],
      { idGenerator: ids }
    );
    const generated = generateCompetitionBracket(withTeams.competition, { idGenerator: ids });
    expect(generated.ok).toBe(true);
    expect(generated.competition.stages[0].rounds[0].byes).toEqual([{ teamId: 't3' }]);
    const listed = listCompetitionPerformanceMatches({
      schemaVersion: 2,
      competitions: [generated.competition],
    });
    expect(listed.matches).toHaveLength(1);
    expect(listed.matches[0].status).toBe(ANALYZABLE_MATCH_PENDING);
  });
});

describe('classifyPerformanceMatch e createAnalyzableMatch', () => {
  it('compartilha included, pending e invalid entre factory e adapters', () => {
    expect(classifyPerformanceMatch({ scoreA: 21, scoreB: 18 })).toBe(ANALYZABLE_MATCH_INCLUDED);
    expect(classifyPerformanceMatch({ scoreA: null, scoreB: null })).toBe(ANALYZABLE_MATCH_PENDING);
    expect(classifyPerformanceMatch({ scoreA: 21, scoreB: 21 })).toBe(ANALYZABLE_MATCH_INVALID);
    expect(classifyPerformanceMatch({ scoreA: 21, scoreB: null })).toBe(ANALYZABLE_MATCH_INVALID);

    expect(createAnalyzableMatch({ scoreA: 21, scoreB: 18 }).status).toBe(ANALYZABLE_MATCH_INCLUDED);
    expect(createAnalyzableMatch({ scoreA: null, scoreB: null }).status).toBe(
      ANALYZABLE_MATCH_PENDING
    );
    expect(createAnalyzableMatch({ scoreA: 21, scoreB: 21 }).status).toBe(ANALYZABLE_MATCH_INVALID);
    expect(
      createAnalyzableMatch({
        sourceType: MATCH_SOURCE_SESSION,
        cycleNumber: 2,
        scoreA: 21,
        scoreB: 18,
      }).cycleNumber
    ).toBe(2);
  });

  it('usa originKey do id legado e deduplica Gist+cloud importado', () => {
    const listed = listSessionPerformanceMatches({
      schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
      sessions: [
        {
          id: 'sess-1',
          date: '2026-09-12',
          name: 'Sábado',
          createdAt: ISO,
          updatedAt: ISO,
          rounds: [
            {
              id: 'r1',
              number: 1,
              matches: [
                {
                  id: 'm1',
                  lineupA: [member('andre', 'André')],
                  lineupB: [member('ana', 'Ana')],
                  scoreA: 21,
                  scoreB: 18,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(listed.matches[0].originKey).toBe('sess-1');

    const cloudCopy = {
      ...listed.matches[0],
      sourceId: 'cloud-uuid',
      originKey: 'sess-1',
    };
    const deduped = dedupePerformanceMatchesByOrigin([...listed.matches, cloudCopy]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].sourceId).toBe('sess-1');
  });
});
