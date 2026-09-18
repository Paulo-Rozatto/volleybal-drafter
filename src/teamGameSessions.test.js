import { describe, expect, it } from 'vitest';
import { TEAM_SESSION_SCHEMA_VERSION, validateV2Document } from './domain/teamSession.js';
import { countSessionMatches } from './domain/sessionValidation.js';
import {
  addSessionTeam,
  appendDraftTeamSession,
  appendTeamSessionRoundRobinCycle,
  availablePlayersForTeams,
  canClearSessionScores,
  canEditSessionScores,
  canEditSessionTeams,
  canEnableFinalizeTeamSession,
  canGenerateTeamSessionRounds,
  canAppendTeamSessionRoundRobinCycle,
  classifyLineupMember,
  clearTeamSessionMatchScore,
  createDraftTeamSession,
  describeMatchLineupDraft,
  eligiblePlayersForMatchSide,
  filterPlayersByName,
  finalizeTeamSession,
  playerBaseTeam,
  removeSessionTeam,
  replaceSessionTeams,
  restoreMatchLineupsFromBaseTeams,
  resetTeamSessionToDraftForTeamEditing,
  setTeamSessionMatchLineups,
  startTeamSessionRoundRobin,
  takenTeamPlayerIds,
  teamMemberIdsInRoster,
  teamSessionFinalizeProgressLabel,
  teamSessionIsReadyToFinalize,
  updateSessionTeam,
  deleteTeamSession,
  DELETE_TEAM_SESSION_CONFIRMATION_REQUIRED,
  FORMAT_CHANGE_CONFIRMATION_REQUIRED,
  FORMAT_CHANGE_CONFIRMATION_MESSAGE,
  updateTeamSessionDetails,
  setTeamSessionMatchScore,
} from './teamGameSessions.js';

const NOW = () => new Date('2026-09-12T19:00:00.000Z');
const LATER = () => new Date('2026-09-12T20:00:00.000Z');
const ISO_CREATED = '2026-09-12T18:00:00.000Z';
const ISO_UPDATED = '2026-09-12T19:00:00.000Z';

const roster = [
  { id: 'p1', name: 'Erik', score: 4 },
  { id: 'p2', name: 'André', score: 3 },
  { id: 'p3', name: 'Gabi', score: 4 },
  { id: 'p4', name: 'Luiza', score: 3 },
  { id: 'p5', name: 'Ian', score: 2 },
  { id: 'p6', name: 'Ana', score: 2 },
  { id: 'p7', name: 'BH', score: 3 },
  { id: 'p8', name: 'Arthur', score: 3 },
];

function makeRoster(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Jogador ${index + 1}`,
  }));
}

function member(playerId, playerName) {
  return { playerId, playerName };
}

function team(id, members) {
  return { id, members };
}

function draftSession(overrides = {}) {
  return {
    id: 'session-1',
    date: '2026-09-12',
    name: 'Arena',
    status: 'draft',
    createdAt: ISO_CREATED,
    updatedAt: ISO_CREATED,
    format: { teamSize: 2, teamCount: 2 },
    teams: [],
    rounds: [],
    ...overrides,
  };
}

function documentWith(session, extraSessions = []) {
  return {
    schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
    sessions: [session, ...extraSessions],
  };
}

function sequentialIds(prefix = 'id') {
  let count = 0;
  return () => `${prefix}-${(count += 1)}`;
}

function allMatches(rounds) {
  return (rounds ?? []).flatMap((round) => round.matches ?? []);
}

describe('createDraftTeamSession e appendDraftTeamSession', () => {
  it('cria o padrão 2x2 com capacidade para dois times', () => {
    const session = createDraftTeamSession(
      { date: '2026-09-12', name: 'Sábado na Arena' },
      { idGenerator: () => 'session-1', now: NOW }
    );

    expect(session).toEqual({
      id: 'session-1',
      date: '2026-09-12',
      name: 'Sábado na Arena',
      status: 'draft',
      createdAt: ISO_UPDATED,
      updatedAt: ISO_UPDATED,
      format: { teamSize: 2, teamCount: 2 },
      teams: [],
      rounds: [],
    });
    expect(session).not.toHaveProperty('pairs');
  });

  it('aceita formatos 2x2 até 6x6 e teamCount explícito', () => {
    for (const teamSize of [2, 3, 4, 5, 6]) {
      const session = createDraftTeamSession(
        { date: '2026-09-12', format: { teamSize, teamCount: 4 } },
        { idGenerator: () => `s-${teamSize}`, now: NOW }
      );
      expect(session.format).toEqual({ teamSize, teamCount: 4 });
    }
  });

  it('apara o nome e converte vazio em null', () => {
    expect(
      createDraftTeamSession(
        { date: '2026-09-12', name: '  Arena  ' },
        { idGenerator: () => 's1', now: NOW }
      ).name
    ).toBe('Arena');
    expect(
      createDraftTeamSession({ date: '2026-09-12', name: '   ' }, { idGenerator: () => 's2', now: NOW }).name
    ).toBeNull();
  });

  it('rejeita data inválida e formato inválido', () => {
    expect(() => createDraftTeamSession({ date: '12/09/2026' })).toThrow(
      'A data deve estar no formato YYYY-MM-DD.'
    );
    expect(() =>
      createDraftTeamSession({ date: '2026-09-12', format: { teamSize: 1, teamCount: 2 } })
    ).toThrow('O tamanho do time deve ser um inteiro entre 2 e 6.');
    expect(() =>
      createDraftTeamSession({ date: '2026-09-12', format: { teamSize: 2, teamCount: 1 } })
    ).toThrow('A quantidade de times deve ser um inteiro maior ou igual a 2.');
  });

  it('aceita ID/relógio injetáveis, emite schema V2 e não muta a entrada', () => {
    const input = { date: '2026-09-12', name: 'Arena', format: { teamSize: 6, teamCount: 3 } };
    const snapshot = JSON.parse(JSON.stringify(input));
    const original = { schemaVersion: 1, sessions: [{ id: 'old' }] };

    const { document, session } = appendDraftTeamSession(original, input, {
      idGenerator: () => 'session-2',
      now: NOW,
    });

    expect(session.id).toBe('session-2');
    expect(session.createdAt).toBe(ISO_UPDATED);
    expect(document.schemaVersion).toBe(TEAM_SESSION_SCHEMA_VERSION);
    expect(document.sessions[0]).toEqual({ id: 'old' });
    expect(document.sessions[1]).toBe(session);
    expect(input).toEqual(snapshot);
    expect(original.schemaVersion).toBe(1);
    expect(original.sessions).toHaveLength(1);
  });
});

describe('CRUD de times-base', () => {
  it('adiciona time completo, incompleto e vazio', () => {
    const original = documentWith(draftSession({ format: { teamSize: 6, teamCount: 3 } }));
    const full = addSessionTeam(original, 'session-1', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], {
      roster,
      idGenerator: () => 'team-1',
      now: NOW,
    });
    expect(full.ok).toBe(true);
    expect(full.team.members).toHaveLength(6);
    expect(full.team.members[0]).toEqual({ playerId: 'p1', playerName: 'Erik' });
    expect(full.team.members[0]).not.toHaveProperty('score');

    const incomplete = addSessionTeam(full.document, 'session-1', ['p7'], {
      roster,
      idGenerator: () => 'team-2',
      now: LATER,
    });
    expect(incomplete.session.teams[1].members).toEqual([member('p7', 'BH')]);

    const empty = addSessionTeam(incomplete.document, 'session-1', [], {
      roster,
      idGenerator: () => 'team-3',
      now: LATER,
    });
    expect(empty.session.teams[2]).toEqual({ id: 'team-3', members: [] });
    expect(empty.session.status).toBe('draft');
    expect(empty.session.rounds).toEqual([]);
  });

  it('rejeita capacidade excedida, teamCount excedido e jogadores inválidos', () => {
    const session = draftSession({ format: { teamSize: 2, teamCount: 2 } });
    expect(
      addSessionTeam(documentWith(session), 'session-1', ['p1', 'p2', 'p3'], { roster, now: NOW }).errors[0]
        .code
    ).toBe('TEAM_CAPACITY_EXCEEDED');

    const twoTeams = {
      ...session,
      teams: [team('team-1', [member('p1', 'Erik')]), team('team-2', [member('p2', 'André')])],
    };
    expect(
      addSessionTeam(documentWith(twoTeams), 'session-1', ['p3'], {
        roster,
        idGenerator: () => 'team-3',
        now: NOW,
      }).errors[0].code
    ).toBe('TEAM_COUNT_EXCEEDED');

    expect(
      addSessionTeam(documentWith(session), 'session-1', ['missing'], {
        roster,
        idGenerator: () => 'team-1',
        now: NOW,
      }).errors[0].code
    ).toBe('TEAM_PLAYER_NOT_FOUND');

    expect(
      addSessionTeam(documentWith(session), 'session-1', ['p1', 'p1'], {
        roster,
        idGenerator: () => 'team-1',
        now: NOW,
      }).errors.some((item) => item.code === 'TEAM_DUPLICATE_PLAYER')
    ).toBe(true);

    for (const teamSize of [2, 3, 4, 5, 6]) {
      const oversizedIds = makeRoster(teamSize + 1).map((player) => player.id);
      expect(
        addSessionTeam(
          documentWith(draftSession({ format: { teamSize, teamCount: 2 } })),
          'session-1',
          oversizedIds,
          { roster: makeRoster(teamSize + 1), idGenerator: () => 'team-x', now: NOW }
        ).errors[0].code
      ).toBe('TEAM_CAPACITY_EXCEEDED');
    }

    const withFirst = addSessionTeam(documentWith(session), 'session-1', ['p1'], {
      roster,
      idGenerator: () => 'team-1',
      now: NOW,
    });
    expect(
      addSessionTeam(withFirst.document, 'session-1', ['p1'], {
        roster,
        idGenerator: () => 'team-2',
        now: NOW,
      }).errors.some((item) => item.code === 'TEAM_PLAYER_ALREADY_ASSIGNED')
    ).toBe(true);
  });

  it('edita preservando o ID e liberando os próprios integrantes', () => {
    const original = documentWith(
      draftSession({
        teams: [
          team('team-1', [member('p1', 'Erik antigo'), member('p2', 'André')]),
          team('team-2', [member('p3', 'Gabi')]),
        ],
      })
    );

    const result = updateSessionTeam(original, 'session-1', 'team-1', ['p1', 'p4'], {
      roster: [
        { id: 'p1', name: 'Erik novo' },
        { id: 'p2', name: 'André' },
        { id: 'p3', name: 'Gabi' },
        { id: 'p4', name: 'Luiza' },
      ],
      now: NOW,
    });

    expect(result.ok).toBe(true);
    expect(result.team.id).toBe('team-1');
    expect(result.team.members).toEqual([member('p1', 'Erik novo'), member('p4', 'Luiza')]);
    expect(result.session.teams[1]).toEqual(team('team-2', [member('p3', 'Gabi')]));
    expect(original.sessions[0].teams[0].members[0].playerName).toBe('Erik antigo');
  });

  it('permite esvaziar um time na edição e remove somente o indicado', () => {
    const original = documentWith(
      draftSession({
        format: { teamSize: 6, teamCount: 2 },
        teams: [team('team-1', [member('p1', 'Erik')]), team('team-2', [member('p2', 'André')])],
      })
    );

    const reduced = updateSessionTeam(original, 'session-1', 'team-1', ['p1'], { roster, now: NOW });
    expect(reduced.team.id).toBe('team-1');
    expect(reduced.team.members).toEqual([member('p1', 'Erik')]);

    const expanded = updateSessionTeam(reduced.document, 'session-1', 'team-1', ['p1', 'p4', 'p5'], {
      roster,
      now: LATER,
    });
    expect(expanded.team.members).toEqual([
      member('p1', 'Erik'),
      member('p4', 'Luiza'),
      member('p5', 'Ian'),
    ]);

    const emptied = updateSessionTeam(original, 'session-1', 'team-1', [], { roster, now: NOW });
    expect(emptied.session.teams[0]).toEqual({ id: 'team-1', members: [] });

    const removed = removeSessionTeam(emptied.document, 'session-1', 'team-1', { roster, now: LATER });
    expect(removed.session.teams).toEqual([team('team-2', [member('p2', 'André')])]);
    expect(removed.session.updatedAt).toBe('2026-09-12T20:00:00.000Z');
  });

  it('substitui conjunto completo e parcial sem alterar o format', () => {
    const original = documentWith(
      draftSession({
        format: { teamSize: 6, teamCount: 3 },
        teams: [team('team-1', [member('p1', 'Erik')])],
      })
    );

    const preview = replaceSessionTeams(original, 'session-1', [], { roster, now: NOW });
    expect(preview.errors[0].code).toBe('REPLACE_CONFIRMATION_REQUIRED');
    expect(original.sessions[0].teams).toHaveLength(1);

    const partial = replaceSessionTeams(
      original,
      'session-1',
      [team('t-a', [member('p1', 'Erik')]), team('t-b', [])],
      { roster, now: NOW, replaceConfirmed: true }
    );
    expect(partial.ok).toBe(true);
    expect(partial.session.teams).toHaveLength(2);
    expect(partial.session.format).toEqual({ teamSize: 6, teamCount: 3 });

    const other = draftSession({ id: 'session-2', name: 'Outro' });
    const replaced = replaceSessionTeams(
      documentWith(original.sessions[0], [other]),
      'session-1',
      [
        team('t-1', [member('p1', 'Erik')]),
        team('t-2', [member('p2', 'André')]),
        team('t-3', [member('p3', 'Gabi')]),
      ],
      { roster, now: NOW, replaceConfirmed: true }
    );
    expect(replaced.session.teams).toHaveLength(3);
    expect(replaced.document.schemaVersion).toBe(2);
    expect(replaced.document.sessions[1]).toEqual(other);
  });

  it('impede alteração fora de draft, com rodadas, IDs inválidos e duplicados', () => {
    expect(
      addSessionTeam(documentWith(draftSession({ status: 'in_progress' })), 'session-1', ['p1'], {
        roster,
        now: NOW,
      }).errors[0].code
    ).toBe('TEAMS_LOCKED');
    expect(
      addSessionTeam(documentWith(draftSession({ status: 'finished' })), 'session-1', ['p1'], {
        roster,
        now: NOW,
      }).errors[0].code
    ).toBe('TEAMS_LOCKED');
    expect(
      addSessionTeam(
        documentWith(
          draftSession({
            rounds: [{ id: 'r1', number: 1, byeTeamId: null, matches: [] }],
          })
        ),
        'session-1',
        ['p1'],
        { roster, now: NOW }
      ).errors[0].code
    ).toBe('TEAMS_LOCKED');

    expect(
      updateSessionTeam(documentWith(draftSession()), 'session-1', 'missing', ['p1'], { roster, now: NOW })
        .errors[0].code
    ).toBe('TEAM_NOT_FOUND');
    expect(
      removeSessionTeam(documentWith(draftSession()), 'missing', 'team-1', { roster, now: NOW }).errors[0]
        .code
    ).toBe('SESSION_NOT_FOUND');

    const duplicateIds = replaceSessionTeams(
      documentWith(draftSession({ format: { teamSize: 2, teamCount: 2 } })),
      'session-1',
      [team('same', [member('p1', 'Erik')]), team('same', [member('p2', 'André')])],
      { roster, now: NOW, replaceConfirmed: true }
    );
    expect(duplicateIds.errors.some((item) => item.code === 'TEAM_ID_DUPLICATE')).toBe(true);

    const invalidId = replaceSessionTeams(
      documentWith(draftSession()),
      'session-1',
      [team('  ', [member('p1', 'Erik')])],
      { roster, now: NOW, replaceConfirmed: true }
    );
    expect(invalidId.errors.some((item) => item.code === 'TEAM_ID_INVALID')).toBe(true);
  });

  it('disponibiliza jogadores do próprio time na edição e não muta arrays', () => {
    const teams = [team('team-1', [member('p1', 'Erik')]), team('team-2', [member('p2', 'André')])];
    const snapshot = JSON.parse(JSON.stringify(teams));
    const rosterSnapshot = [...roster];

    expect([...takenTeamPlayerIds(teams)]).toEqual(['p1', 'p2']);
    expect(availablePlayersForTeams(roster, teams).map((player) => player.id)).toEqual([
      'p3',
      'p4',
      'p5',
      'p6',
      'p7',
      'p8',
    ]);
    expect(availablePlayersForTeams(roster, teams, 'team-1').map((player) => player.id)).toContain('p1');
    expect(availablePlayersForTeams(roster, teams, 'team-1').map((player) => player.id)).not.toContain('p2');
    expect(teamMemberIdsInRoster(teams[0], roster)).toEqual(['p1']);
    expect(teams).toEqual(snapshot);
    expect(roster).toEqual(rosterSnapshot);
  });
});

describe('geração das rodadas V2', () => {
  const twoTeams = [
    team('team-1', [member('p1', 'Erik'), member('p2', 'André')]),
    team('team-2', [member('p3', 'Gabi'), member('p4', 'Luiza')]),
  ];
  const threeTeams = [...twoTeams, team('team-3', [member('p5', 'Ian')])];
  const fourTeams = [
    ...twoTeams,
    team('team-3', [member('p5', 'Ian'), member('p6', 'Ana')]),
    team('team-4', [member('p7', 'BH'), member('p8', 'Arthur')]),
  ];

  it('gera dois, três e quatro times com folgas e campos V2', () => {
    const two = startTeamSessionRoundRobin(
      documentWith(draftSession({ teams: twoTeams })),
      'session-1',
      { roster, idGenerator: sequentialIds(), now: NOW, generateConfirmed: true }
    );
    expect(two.session.rounds).toHaveLength(1);
    expect(allMatches(two.session.rounds)).toHaveLength(1);
    expect(two.session.rounds[0].byeTeamId).toBeNull();
    expect(two.session.rounds[0]).not.toHaveProperty('byePairId');
    expect(allMatches(two.session.rounds)[0]).toMatchObject({
      teamAId: expect.any(String),
      teamBId: expect.any(String),
      scoreA: null,
      scoreB: null,
    });
    expect(allMatches(two.session.rounds)[0]).not.toHaveProperty('pairAId');

    const three = startTeamSessionRoundRobin(
      documentWith(draftSession({ format: { teamSize: 2, teamCount: 3 }, teams: threeTeams })),
      'session-1',
      { roster, idGenerator: sequentialIds(), now: NOW, generateConfirmed: true }
    );
    expect(three.session.rounds).toHaveLength(3);
    expect(allMatches(three.session.rounds)).toHaveLength(3);
    expect(three.session.rounds.map((round) => round.byeTeamId).sort()).toEqual([
      'team-1',
      'team-2',
      'team-3',
    ]);

    const four = startTeamSessionRoundRobin(
      documentWith(draftSession({ format: { teamSize: 2, teamCount: 4 }, teams: fourTeams })),
      'session-1',
      { roster, idGenerator: sequentialIds(), now: NOW, generateConfirmed: true }
    );
    expect(four.session.rounds).toHaveLength(3);
    expect(allMatches(four.session.rounds)).toHaveLength(6);
    expect(four.session.rounds.every((round) => round.byeTeamId === null)).toBe(true);
    expect(countSessionMatches(four.session)).toEqual({
      total: 6,
      completed: 0,
      pending: 6,
      invalid: 0,
    });
  });

  it('com courtCount empacota partidas em blocos sem perder confrontos', () => {
    const bigRoster = makeRoster(12);
    const sixTeams = Array.from({ length: 6 }, (_, index) =>
      team(`team-${index + 1}`, [
        member(bigRoster[index * 2].id, bigRoster[index * 2].name),
        member(bigRoster[index * 2 + 1].id, bigRoster[index * 2 + 1].name),
      ])
    );
    const result = startTeamSessionRoundRobin(
      documentWith(draftSession({ format: { teamSize: 2, teamCount: 6 }, teams: sixTeams })),
      'session-1',
      {
        roster: bigRoster,
        idGenerator: sequentialIds(),
        now: NOW,
        generateConfirmed: true,
        courtCount: 2,
      }
    );

    expect(result.ok).toBe(true);
    expect(result.session.courtCount).toBe(2);
    expect(allMatches(result.session.rounds)).toHaveLength(15);
    expect(result.session.rounds.every((round) => round.matches.length <= 2)).toBe(true);
    expect(result.session.rounds.every((round) => round.cycleNumber === 1)).toBe(true);
    expect(result.session.rounds.length).toBeGreaterThan(5);
  });

  it('acrescenta um novo ciclo com as mesmas duplas sem apagar o anterior', () => {
    const started = startTeamSessionRoundRobin(
      documentWith(draftSession({ teams: twoTeams })),
      'session-1',
      { roster, idGenerator: sequentialIds(), now: NOW, generateConfirmed: true }
    );
    const round = started.session.rounds[0];
    const match = round.matches[0];
    const scored = setTeamSessionMatchScore(
      started.document,
      'session-1',
      round.id,
      match.id,
      21,
      18,
      { now: LATER }
    );
    expect(canAppendTeamSessionRoundRobinCycle(scored.session)).toBe(true);

    const preview = appendTeamSessionRoundRobinCycle(scored.document, 'session-1', {
      roster,
      idGenerator: sequentialIds('next'),
      now: LATER,
      appendConfirmed: false,
    });
    expect(preview.errors[0].code).toBe('APPEND_CYCLE_CONFIRMATION_REQUIRED');

    const appended = appendTeamSessionRoundRobinCycle(scored.document, 'session-1', {
      roster,
      idGenerator: sequentialIds('next'),
      now: LATER,
      appendConfirmed: true,
    });
    expect(appended.ok).toBe(true);
    expect(appended.session.rounds).toHaveLength(2);
    expect(appended.session.rounds[0].matches[0]).toMatchObject({
      id: match.id,
      scoreA: 21,
      scoreB: 18,
      lineupA: match.lineupA,
    });
    expect(appended.session.rounds[1].cycleNumber).toBe(2);
    expect(appended.session.rounds[1].matches[0].id).not.toBe(match.id);
    expect(appended.session.rounds[1].matches[0].scoreA).toBeNull();
    expect(scored.session.rounds).toHaveLength(1);
  });

  it('copia lineups iniciais de forma independente, inclusive incompletas', () => {
    const originalTeams = [
      team('team-1', [member('p1', 'Erik')]),
      team('team-2', [member('p3', 'Gabi'), member('p4', 'Luiza')]),
    ];
    const original = documentWith(
      draftSession({ format: { teamSize: 2, teamCount: 2 }, teams: originalTeams })
    );

    const result = startTeamSessionRoundRobin(original, 'session-1', {
      roster,
      idGenerator: sequentialIds(),
      now: NOW,
      generateConfirmed: true,
    });
    const match = allMatches(result.session.rounds)[0];
    const lineupFor = (teamId) => (match.teamAId === teamId ? match.lineupA : match.lineupB);

    expect(lineupFor('team-1')).toEqual([member('p1', 'Erik')]);
    expect(lineupFor('team-2')).toHaveLength(2);
    expect(lineupFor('team-1')).not.toBe(original.sessions[0].teams[0].members);
    expect(lineupFor('team-1')[0]).not.toBe(original.sessions[0].teams[0].members[0]);

    lineupFor('team-1')[0].playerName = 'X';
    expect(result.session.teams[0].members[0].playerName).toBe('Erik');
    expect(original.sessions[0].teams[0].members[0].playerName).toBe('Erik');
    expect(result.session.status).toBe('in_progress');
    expect(result.session.format).toEqual({ teamSize: 2, teamCount: 2 });
    expect(canEditSessionTeams(result.session)).toBe(false);
  });

  it('impede geração com time vazio, quantidade diferente de teamCount e ID inválido sem aplicar parcialmente', () => {
    const emptyTeam = startTeamSessionRoundRobin(
      documentWith(
        draftSession({
          teams: [team('team-1', [member('p1', 'Erik')]), team('team-2', [])],
        })
      ),
      'session-1',
      { roster, now: NOW, generateConfirmed: true }
    );
    expect(emptyTeam.errors[0].code).toBe('TEAM_EMPTY');
    expect(canGenerateTeamSessionRounds(emptyTeam.session ?? draftSession({
      teams: [team('team-1', [member('p1', 'Erik')]), team('team-2', [])],
    }), roster)).toBe(false);

    const mismatch = startTeamSessionRoundRobin(
      documentWith(
        draftSession({
          format: { teamSize: 2, teamCount: 3 },
          teams: twoTeams,
        })
      ),
      'session-1',
      { roster, now: NOW, generateConfirmed: true }
    );
    expect(mismatch.errors[0].code).toBe('TEAM_COUNT_MISMATCH');

    const original = documentWith(draftSession({ teams: twoTeams }));
    const failedIds = startTeamSessionRoundRobin(original, 'session-1', {
      roster,
      idGenerator: () => 'same',
      now: NOW,
      generateConfirmed: true,
    });
    expect(failedIds.errors[0].code).toBe('ROUND_ROBIN_FAILED');
    expect(failedIds.document).toBeNull();
    expect(original.sessions[0].status).toBe('draft');
    expect(original.sessions[0].rounds).toEqual([]);
  });

  it('cancela geração e reset sem alteração quando a confirmação é exigida', () => {
    const original = documentWith(draftSession({ teams: twoTeams }));
    const preview = startTeamSessionRoundRobin(original, 'session-1', {
      roster,
      now: NOW,
      generateConfirmed: false,
    });
    expect(preview.errors[0].code).toBe('GENERATE_ROUNDS_CONFIRMATION_REQUIRED');
    expect(original.sessions[0].status).toBe('draft');
  });

  it('volta para draft preservando times e apagando lineups e placares', () => {
    const other = draftSession({ id: 'session-2', name: 'Outro' });
    const started = startTeamSessionRoundRobin(
      documentWith(draftSession({ teams: twoTeams }), [other]),
      'session-1',
      { roster, idGenerator: sequentialIds(), now: NOW, generateConfirmed: true }
    );
    started.session.rounds[0].matches[0].scoreA = 21;
    started.session.rounds[0].matches[0].scoreB = 18;

    const preview = resetTeamSessionToDraftForTeamEditing(started.document, 'session-1', { now: LATER });
    expect(preview.errors[0].code).toBe('RESET_TO_DRAFT_CONFIRMATION_REQUIRED');

    const reset = resetTeamSessionToDraftForTeamEditing(started.document, 'session-1', {
      now: LATER,
      resetConfirmed: true,
    });
    expect(reset.ok).toBe(true);
    expect(reset.session.status).toBe('draft');
    expect(reset.session.rounds).toEqual([]);
    expect(reset.session.teams).toEqual(twoTeams);
    expect(reset.session.teams).not.toBe(started.session.teams);
    expect(reset.session.format).toEqual({ teamSize: 2, teamCount: 2 });
    expect(reset.session.updatedAt).toBe('2026-09-12T20:00:00.000Z');
    expect(reset.session.createdAt).toBe(ISO_CREATED);
    expect(reset.document.sessions[1]).toEqual(other);
    expect(JSON.stringify(reset.session)).not.toContain('lineupA');
  });

  it('rejeita reset em finished e não muta a entrada', () => {
    const original = documentWith(draftSession({ status: 'finished', teams: twoTeams }));
    const snapshot = JSON.parse(JSON.stringify(original));
    expect(
      resetTeamSessionToDraftForTeamEditing(original, 'session-1', { resetConfirmed: true }).errors[0].code
    ).toBe('SESSION_FINISHED');
    expect(original).toEqual(snapshot);
  });
});

describe('16 jogadores em três times 6x6', () => {
  it('aceita a base 6/5/5 e gera rodadas sem completar lineups', () => {
    const bigRoster = makeRoster(16);
    const teams = [
      team(
        'team-1',
        bigRoster.slice(0, 6).map((player) => member(player.id, player.name))
      ),
      team(
        'team-2',
        bigRoster.slice(6, 11).map((player) => member(player.id, player.name))
      ),
      team(
        'team-3',
        bigRoster.slice(11, 16).map((player) => member(player.id, player.name))
      ),
    ];

    expect(teams.map((item) => item.members.length)).toEqual([6, 5, 5]);
    const usedIds = teams.flatMap((item) => item.members.map((entry) => entry.playerId));
    expect(usedIds).toHaveLength(16);
    expect(new Set(usedIds).size).toBe(16);

    const session = draftSession({
      format: { teamSize: 6, teamCount: 3 },
      teams,
    });
    expect(canGenerateTeamSessionRounds(session, bigRoster)).toBe(true);

    const result = startTeamSessionRoundRobin(documentWith(session), 'session-1', {
      roster: bigRoster,
      idGenerator: sequentialIds(),
      now: NOW,
      generateConfirmed: true,
    });

    expect(result.ok).toBe(true);
    expect(result.session.status).toBe('in_progress');
    expect(result.session.rounds).toHaveLength(3);
    expect(allMatches(result.session.rounds)).toHaveLength(3);
    expect(result.session.rounds.map((round) => round.byeTeamId).sort()).toEqual([
      'team-1',
      'team-2',
      'team-3',
    ]);

    const sizeByTeam = Object.fromEntries(teams.map((item) => [item.id, item.members.length]));
    for (const match of allMatches(result.session.rounds)) {
      expect(match.lineupA).toHaveLength(sizeByTeam[match.teamAId]);
      expect(match.lineupB).toHaveLength(sizeByTeam[match.teamBId]);
      expect(match.scoreA).toBeNull();
      expect(match.scoreB).toBeNull();
      expect([5, 6]).toContain(match.lineupA.length);
      expect([5, 6]).toContain(match.lineupB.length);
    }

    const sixVsFive = allMatches(result.session.rounds).find(
      (match) =>
        (match.teamAId === 'team-1' && match.lineupA.length === 6) ||
        (match.teamBId === 'team-1' && match.lineupB.length === 6)
    );
    expect(sixVsFive).toBeTruthy();
    expect(result.session.teams[1].members).toHaveLength(5);

    const incompleteMatch = allMatches(result.session.rounds).find(
      (match) => match.lineupA.length === 5 || match.lineupB.length === 5
    );
    const scoredRound = result.session.rounds.find((round) =>
      (round.matches ?? []).some((match) => match.id === incompleteMatch.id)
    );
    const scored = setTeamSessionMatchScore(
      result.document,
      'session-1',
      scoredRound.id,
      incompleteMatch.id,
      21,
      18,
      { now: LATER }
    );
    expect(scored.ok).toBe(true);
    expect(
      scored.session.rounds
        .flatMap((round) => round.matches)
        .find((match) => match.id === incompleteMatch.id)
    ).toMatchObject({
      scoreA: 21,
      scoreB: 18,
    });

    const reset = resetTeamSessionToDraftForTeamEditing(scored.document, 'session-1', {
      now: LATER,
      resetConfirmed: true,
    });
    expect(reset.session.status).toBe('draft');
    expect(reset.session.rounds).toEqual([]);
    expect(reset.session.teams.map((item) => item.members.length)).toEqual([6, 5, 5]);
    expect(
      reset.session.teams.flatMap((item) => item.members.map((entry) => entry.playerId))
    ).toHaveLength(16);
  });
});

describe('placares V2', () => {
  const twoTeams = [
    team('team-1', [member('p1', 'Erik'), member('p2', 'André')]),
    team('team-2', [member('p3', 'Gabi'), member('p4', 'Luiza')]),
  ];

  function inProgressDocument() {
    return startTeamSessionRoundRobin(
      documentWith(draftSession({ teams: twoTeams })),
      'session-1',
      { roster, idGenerator: sequentialIds(), now: NOW, generateConfirmed: true }
    ).document;
  }

  it('grava, edita e limpa placar sem finalizar o encontro', () => {
    const original = inProgressDocument();
    const snapshot = JSON.parse(JSON.stringify(original));
    const round = original.sessions[0].rounds[0];
    const match = round.matches[0];
    const first = setTeamSessionMatchScore(original, 'session-1', round.id, match.id, 21, 18, {
      now: LATER,
    });

    expect(first.ok).toBe(true);
    expect(first.session.status).toBe('in_progress');
    expect(first.session.rounds[0].matches[0]).toMatchObject({
      teamAId: expect.any(String),
      teamBId: expect.any(String),
      scoreA: 21,
      scoreB: 18,
    });
    expect(first.session.updatedAt).toBe('2026-09-12T20:00:00.000Z');
    expect(original).toEqual(snapshot);
    expect(teamSessionIsReadyToFinalize(first.session)).toBe(true);

    const cleared = clearTeamSessionMatchScore(first.document, 'session-1', round.id, match.id, {
      now: LATER,
      clearConfirmed: true,
    });
    expect(cleared.session.rounds[0].matches[0].scoreA).toBeNull();
    expect(cleared.session.rounds[0].matches[0].scoreB).toBeNull();
    expect(cleared.session.status).toBe('in_progress');
    expect(teamSessionIsReadyToFinalize(cleared.session)).toBe(false);
  });

  it('edita placar de encontro finalizado sem reabrir nem permitir limpar', () => {
    const live = inProgressDocument();
    const round = live.sessions[0].rounds[0];
    const match = round.matches[0];
    const scored = setTeamSessionMatchScore(live, 'session-1', round.id, match.id, 21, 18, {
      now: NOW,
    });
    const finished = finalizeTeamSession(scored.document, 'session-1', {
      now: LATER,
      finalizeConfirmed: true,
    });
    const snapshot = JSON.parse(JSON.stringify(finished.document));
    const later = () => new Date('2026-09-12T21:00:00.000Z');

    expect(canEditSessionScores(finished.session)).toBe(true);
    expect(canClearSessionScores(finished.session)).toBe(false);
    expect(canEditSessionScores(scored.session)).toBe(true);
    expect(canClearSessionScores(scored.session)).toBe(true);
    expect(canEditSessionScores({ status: 'draft' })).toBe(false);

    const edited = setTeamSessionMatchScore(
      finished.document,
      'session-1',
      round.id,
      match.id,
      25,
      20,
      { now: later }
    );

    expect(edited.ok).toBe(true);
    expect(edited.session.status).toBe('finished');
    expect(edited.session.rounds[0].matches[0]).toMatchObject({ scoreA: 25, scoreB: 20 });
    expect(edited.session.rounds[0].matches[0].lineupA).toEqual(match.lineupA);
    expect(edited.session.rounds[0].matches[0].lineupB).toEqual(match.lineupB);
    expect(edited.session.teams).toEqual(finished.session.teams);
    expect(edited.session.updatedAt).toBe('2026-09-12T21:00:00.000Z');
    expect(validateV2Document(edited.document).ok).toBe(true);
    expect(finished.document).toEqual(snapshot);

    expect(
      setTeamSessionMatchScore(finished.document, 'session-1', round.id, match.id, 21, 21).errors[0]
        .code
    ).toBe('SCORE_TIE');
    expect(
      clearTeamSessionMatchScore(edited.document, 'session-1', round.id, match.id, {
        clearConfirmed: true,
      }).errors[0].code
    ).toBe('SESSION_FINISHED');
    expect(
      setTeamSessionMatchScore(
        documentWith(draftSession({ teams: twoTeams })),
        'session-1',
        round.id,
        match.id,
        21,
        18
      ).errors[0].code
    ).toBe('SESSION_NOT_IN_PROGRESS');
  });

  it('reutiliza validateScore e não muta a entrada', () => {
    const original = inProgressDocument();
    const snapshot = JSON.parse(JSON.stringify(original));
    const round = original.sessions[0].rounds[0];
    const match = round.matches[0];
    expect(
      setTeamSessionMatchScore(original, 'session-1', round.id, match.id, 21, 21).errors[0].code
    ).toBe('SCORE_TIE');
    expect(original).toEqual(snapshot);
  });
});

describe('escalações por partida', () => {
  const extraRoster = [...roster, { id: 'p9', name: 'Fora', score: 1 }];
  const sixRoster = makeRoster(16);

  function sizedTeam(id, start, count) {
    return team(
      id,
      sixRoster.slice(start, start + count).map((player) => member(player.id, player.name))
    );
  }

  function matchShape({ id, teamAId, teamBId, lineupA, lineupB, scoreA = null, scoreB = null }) {
    return { id, teamAId, teamBId, lineupA, lineupB, scoreA, scoreB };
  }

  function inProgressSixes() {
    const teams = [sizedTeam('team-1', 0, 6), sizedTeam('team-2', 6, 5), sizedTeam('team-3', 11, 5)];
    return documentWith(
      draftSession({
        name: '16/3/6',
        status: 'in_progress',
        updatedAt: ISO_UPDATED,
        format: { teamSize: 6, teamCount: 3 },
        teams,
        rounds: [
          {
            id: 'r1',
            number: 1,
            byeTeamId: 'team-3',
            matches: [
              matchShape({
                id: 'm1',
                teamAId: 'team-1',
                teamBId: 'team-2',
                lineupA: teams[0].members,
                lineupB: teams[1].members,
                scoreA: 21,
                scoreB: 18,
              }),
            ],
          },
          {
            id: 'r2',
            number: 2,
            byeTeamId: 'team-2',
            matches: [
              matchShape({
                id: 'm2',
                teamAId: 'team-1',
                teamBId: 'team-3',
                lineupA: teams[0].members,
                lineupB: teams[2].members,
              }),
            ],
          },
        ],
      })
    );
  }

  function inProgressFourTeams() {
    const teams = [
      team('t1', [member('p1', 'Erik'), member('p2', 'André')]),
      team('t2', [member('p3', 'Gabi'), member('p4', 'Luiza')]),
      team('t3', [member('p5', 'Ian'), member('p6', 'Ana')]),
      team('t4', [member('p7', 'BH'), member('p8', 'Arthur')]),
    ];
    return documentWith(
      draftSession({
        status: 'in_progress',
        updatedAt: ISO_UPDATED,
        format: { teamSize: 6, teamCount: 4 },
        teams,
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
                lineupA: [member('p1', 'Erik')],
                lineupB: [member('p3', 'Gabi')],
                scoreA: 21,
                scoreB: 19,
              }),
              matchShape({
                id: 'm2',
                teamAId: 't3',
                teamBId: 't4',
                lineupA: [member('p5', 'Ian')],
                lineupB: [member('p7', 'BH')],
              }),
            ],
          },
        ],
      })
    );
  }

  it('aceita lineup inicial, incompleta e empréstimo sem alterar o time-base', () => {
    const original = inProgressSixes();
    const snapshot = JSON.parse(JSON.stringify(original));
    const session = original.sessions[0];
    const initial = session.rounds[0].matches[0];
    expect(initial.lineupA).toHaveLength(6);
    expect(initial.lineupB).toHaveLength(5);

    const incomplete = setTeamSessionMatchLineups(
      original,
      'session-1',
      'r1',
      'm1',
      ['p1', 'p2'],
      ['p7'],
      { roster: sixRoster, now: LATER }
    );
    expect(incomplete.ok).toBe(true);
    expect(incomplete.session.rounds[0].matches[0].lineupA).toHaveLength(2);
    expect(incomplete.session.rounds[0].matches[0].lineupB).toHaveLength(1);

    const completed = setTeamSessionMatchLineups(
      original,
      'session-1',
      'r1',
      'm1',
      initial.lineupA.map((item) => item.playerId),
      [...initial.lineupB.map((item) => item.playerId), 'p12'],
      { roster: sixRoster, now: LATER }
    );
    expect(completed.ok).toBe(true);
    expect(completed.session.rounds[0].matches[0].lineupA).toHaveLength(6);
    expect(completed.session.rounds[0].matches[0].lineupB).toHaveLength(6);
    expect(completed.session.rounds[0].matches[0].lineupB.map((item) => item.playerId)).toContain('p12');
    expect(completed.session.teams[2].members.map((item) => item.playerId)).toContain('p12');
    expect(completed.session.teams).toEqual(session.teams);
    expect(completed.session.rounds[0].matches[0].scoreA).toBe(21);
    expect(completed.session.rounds[0].matches[0].scoreB).toBe(18);
    expect(completed.session.rounds[1]).toEqual(session.rounds[1]);
    expect(completed.session.format).toEqual({ teamSize: 6, teamCount: 3 });
    expect(completed.session.status).toBe('in_progress');
    expect(completed.session.createdAt).toBe(ISO_CREATED);
    expect(completed.session.updatedAt).toBe('2026-09-12T20:00:00.000Z');
    expect(completed.document.schemaVersion).toBe(TEAM_SESSION_SCHEMA_VERSION);
    expect(original).toEqual(snapshot);
    expect(completed.session.rounds[0].matches[0].lineupB.find((item) => item.playerId === 'p12')).toEqual({
      playerId: 'p12',
      playerName: 'Jogador 12',
    });
    expect(completed.session.rounds[0].matches[0].lineupB[0]).not.toHaveProperty('score');
  });

  it('permite o mesmo jogador em partidas diferentes da mesma rodada', () => {
    const original = inProgressFourTeams();
    const snapshot = JSON.parse(JSON.stringify(original));
    const loaned = setTeamSessionMatchLineups(
      original,
      'session-1',
      'r1',
      'm1',
      ['p1', 'p5'],
      ['p3'],
      { roster, now: LATER }
    );
    expect(loaned.ok).toBe(true);
    expect(loaned.session.rounds[0].matches[0].lineupA.map((item) => item.playerId)).toEqual(['p1', 'p5']);
    expect(loaned.session.rounds[0].matches[1].lineupA.map((item) => item.playerId)).toEqual(['p5']);
    expect(loaned.session.rounds[0].matches[1].scoreA).toBeNull();
    expect(original).toEqual(snapshot);

    const both = setTeamSessionMatchLineups(
      loaned.document,
      'session-1',
      'r1',
      'm2',
      ['p5', 'p6'],
      ['p7'],
      { roster, now: LATER }
    );
    expect(both.ok).toBe(true);
    expect(both.session.rounds[0].matches[0].lineupA.map((item) => item.playerId)).toEqual(['p1', 'p5']);
    expect(both.session.rounds[0].matches[1].lineupA.map((item) => item.playerId)).toEqual(['p5', 'p6']);
  });

  it('rejeita duplicado, dois lados, capacidade, vazio, inexistente, sem time e adversário', () => {
    const original = inProgressFourTeams();
    const snapshot = JSON.parse(JSON.stringify(original));

    expect(
      setTeamSessionMatchLineups(original, 'session-1', 'r1', 'm1', ['p1', 'p1'], ['p3'], { roster })
        .errors[0].code
    ).toBe('LINEUP_DUPLICATE_PLAYER');
    expect(
      setTeamSessionMatchLineups(original, 'session-1', 'r1', 'm1', ['p1'], ['p1'], { roster }).errors.some(
        (item) => item.code === 'MATCH_PLAYER_BOTH_SIDES'
      )
    ).toBe(true);
    expect(
      setTeamSessionMatchLineups(
        original,
        'session-1',
        'r1',
        'm1',
        ['p1', 'p2', 'p5', 'p6', 'p7', 'p8', 'p4'],
        ['p3'],
        { roster }
      ).errors[0].code
    ).toBe('LINEUP_CAPACITY_EXCEEDED');
    expect(
      setTeamSessionMatchLineups(original, 'session-1', 'r1', 'm1', [], ['p3'], { roster }).errors[0].code
    ).toBe('LINEUP_EMPTY');
    expect(
      setTeamSessionMatchLineups(original, 'session-1', 'r1', 'm1', ['missing'], ['p3'], { roster })
        .errors[0].code
    ).toBe('LINEUP_PLAYER_NOT_FOUND');
    expect(
      setTeamSessionMatchLineups(original, 'session-1', 'r1', 'm1', ['p9'], ['p3'], { roster: extraRoster })
        .errors[0].code
    ).toBe('LINEUP_PLAYER_WITHOUT_TEAM');
    expect(
      setTeamSessionMatchLineups(original, 'session-1', 'r1', 'm1', ['p3'], ['p1'], { roster }).errors.some(
        (item) => item.code === 'LINEUP_PLAYER_FROM_OPPONENT'
      )
    ).toBe(true);
    expect(original).toEqual(snapshot);
  });

  it('rejeita draft, finished e referências inexistentes, e preserva schema', () => {
    const draft = documentWith(draftSession({ teams: [team('t1', [member('p1', 'Erik')])] }));
    expect(
      setTeamSessionMatchLineups(draft, 'session-1', 'r1', 'm1', ['p1'], ['p3'], { roster }).errors[0].code
    ).toBe('SESSION_NOT_IN_PROGRESS');

    const finished = inProgressFourTeams();
    finished.sessions[0].status = 'finished';
    expect(
      setTeamSessionMatchLineups(finished, 'session-1', 'r1', 'm1', ['p1'], ['p3'], { roster }).errors[0]
        .code
    ).toBe('SESSION_FINISHED');

    const live = inProgressFourTeams();
    expect(
      setTeamSessionMatchLineups(live, 'missing', 'r1', 'm1', ['p1'], ['p3'], { roster }).errors[0].code
    ).toBe('SESSION_NOT_FOUND');
    expect(
      setTeamSessionMatchLineups(live, 'session-1', 'missing', 'm1', ['p1'], ['p3'], { roster }).errors[0]
        .code
    ).toBe('ROUND_NOT_FOUND');
    expect(
      setTeamSessionMatchLineups(live, 'session-1', 'r1', 'missing', ['p1'], ['p3'], { roster }).errors[0]
        .code
    ).toBe('MATCH_NOT_FOUND');
    expect(
      setTeamSessionMatchLineups(
        { schemaVersion: 1, sessions: live.sessions },
        'session-1',
        'r1',
        'm1',
        ['p1'],
        ['p3'],
        { roster }
      ).errors[0].code
    ).toBe('SCHEMA_VERSION_UNSUPPORTED');
  });

  it('preserva snapshots da partida editada e não reescreve times nem as demais partidas', () => {
    const original = inProgressFourTeams();
    original.sessions[0].rounds[0].matches[0].lineupA = [member('p1', 'Erik antigo')];
    original.sessions[0].rounds[0].matches[1].lineupA = [member('p5', 'Ian antigo')];
    const renamedRoster = roster.map((player) =>
      player.id === 'p1' ? { ...player, name: 'Erik atual' } : player
    );

    const updated = setTeamSessionMatchLineups(original, 'session-1', 'r1', 'm1', ['p1'], ['p3'], {
      roster: renamedRoster,
      now: LATER,
    });
    expect(updated.session.rounds[0].matches[0].lineupA[0].playerName).toBe('Erik antigo');
    expect(updated.session.rounds[0].matches[0].lineupB[0].playerName).toBe('Gabi');
    expect(updated.session.rounds[0].matches[1].lineupA[0].playerName).toBe('Ian antigo');
    expect(updated.session.teams[0].members[0].playerName).toBe('Erik');

    const withNewMember = setTeamSessionMatchLineups(
      original,
      'session-1',
      'r1',
      'm1',
      ['p1', 'p2'],
      ['p3'],
      { roster: renamedRoster, now: LATER }
    );
    expect(withNewMember.session.rounds[0].matches[0].lineupA).toEqual([
      member('p1', 'Erik antigo'),
      member('p2', 'André'),
    ]);

    const restored = restoreMatchLineupsFromBaseTeams(
      original.sessions[0].teams,
      original.sessions[0].rounds[0].matches[0]
    );
    expect(restored.ok).toBe(true);
    expect(restored.lineupAPlayerIds).toEqual(['p1', 'p2']);
    expect(restored.lineupBPlayerIds).toEqual(['p3', 'p4']);
    expect(original.sessions[0].rounds[0].matches[0].lineupA).toEqual([member('p1', 'Erik antigo')]);

    const emptyRestore = restoreMatchLineupsFromBaseTeams(
      [team('t1', []), team('t2', [member('p3', 'Gabi')])],
      { teamAId: 't1', teamBId: 't2' }
    );
    expect(emptyRestore.ok).toBe(false);
    expect(emptyRestore.errors[0].code).toBe('TEAM_EMPTY');
  });

  it('calcula elegibilidade dos dois lados e busca ignorando acento', () => {
    const session = inProgressFourTeams().sessions[0];
    const match = session.rounds[0].matches[0];
    const sideA = eligiblePlayersForMatchSide(session.teams, match, 'A', {
      selectedOpponentIds: ['p3'],
      roster,
    });
    const sideB = eligiblePlayersForMatchSide(session.teams, match, 'B', {
      selectedOpponentIds: ['p1'],
      roster,
    });

    expect(sideA.map((player) => player.id)).toEqual(['p1', 'p2', 'p5', 'p6', 'p7', 'p8']);
    expect(sideA.find((player) => player.id === 'p1').isOwnTeam).toBe(true);
    expect(sideA.find((player) => player.id === 'p5').isOwnTeam).toBe(false);
    expect(sideA.map((player) => player.id)).not.toContain('p3');
    expect(sideA.map((player) => player.id)).not.toContain('p4');
    expect(sideB.map((player) => player.id)).toEqual(['p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    expect(sideB.map((player) => player.id)).not.toContain('p1');
    expect(playerBaseTeam(session.teams, 'p5').id).toBe('t3');
    expect(classifyLineupMember(member('p5', 'Ian'), session.teams, 't1').isLoan).toBe(true);

    const withAccent = [
      { id: 'p2', name: 'Estêvão' },
      { id: 'p3', name: 'Gabi' },
    ];
    expect(filterPlayersByName(withAccent, 'estevao').map((player) => player.id)).toEqual(['p2']);
    expect(
      describeMatchLineupDraft({
        lineupAPlayerIds: ['p1'],
        lineupBPlayerIds: ['p3'],
        match,
        teams: session.teams,
        format: session.format,
        roster,
      }).ok
    ).toBe(true);
  });
});

describe('finalização de encontros V2', () => {
  const twoTeams = [
    team('team-1', [member('p1', 'Erik'), member('p2', 'André')]),
    team('team-2', [member('p3', 'Gabi'), member('p4', 'Luiza')]),
  ];
  const otherSession = draftSession({ id: 'session-2', name: 'Outro' });

  function inProgressTwoTeams() {
    return startTeamSessionRoundRobin(
      documentWith(draftSession({ teams: twoTeams }), [otherSession]),
      'session-1',
      { roster, idGenerator: sequentialIds(), now: NOW, generateConfirmed: true }
    ).document;
  }

  function inProgressThreeTeams() {
    const sixRoster = makeRoster(16);
    const sized = (id, start, count) =>
      team(
        id,
        sixRoster.slice(start, start + count).map((player) => member(player.id, player.name))
      );
    return startTeamSessionRoundRobin(
      documentWith(
        draftSession({
          format: { teamSize: 6, teamCount: 3 },
          teams: [sized('t1', 0, 6), sized('t2', 6, 5), sized('t3', 11, 5)],
        })
      ),
      'session-1',
      { roster: sixRoster, idGenerator: sequentialIds(), now: NOW, generateConfirmed: true }
    ).document;
  }

  function scoreEveryMatch(document, now = LATER) {
    let current = document;
    for (const round of current.sessions[0].rounds) {
      for (const match of round.matches) {
        const result = setTeamSessionMatchScore(
          current,
          'session-1',
          round.id,
          match.id,
          21,
          18,
          { now }
        );
        if (!result.ok) {
          throw new Error(result.errors[0]?.code ?? 'score failed');
        }
        current = result.document;
      }
    }
    return current;
  }

  it('finaliza encontro completo preservando times, lineups, placares e schema', () => {
    const original = scoreEveryMatch(inProgressTwoTeams());
    const snapshot = JSON.parse(JSON.stringify(original));
    const session = original.sessions[0];
    const match = session.rounds[0].matches[0];

    expect(canEnableFinalizeTeamSession(session)).toBe(true);
    expect(teamSessionIsReadyToFinalize(session)).toBe(true);
    expect(teamSessionFinalizeProgressLabel(session)).toBe('1 de 1 partidas concluídas');
    expect(session.status).toBe('in_progress');

    const cancelled = finalizeTeamSession(original, 'session-1', {
      now: LATER,
      finalizeConfirmed: false,
    });
    expect(cancelled.ok).toBe(false);
    expect(cancelled.errors[0].code).toBe('FINALIZE_CONFIRMATION_REQUIRED');
    expect(original).toEqual(snapshot);

    const finished = finalizeTeamSession(original, 'session-1', {
      now: LATER,
      finalizeConfirmed: true,
    });
    expect(finished.ok).toBe(true);
    expect(finished.session.status).toBe('finished');
    expect(finished.session.createdAt).toBe(ISO_CREATED);
    expect(finished.session.updatedAt).toBe('2026-09-12T20:00:00.000Z');
    expect(finished.session.format).toEqual({ teamSize: 2, teamCount: 2 });
    expect(finished.session.teams).toEqual(session.teams);
    expect(finished.session.rounds).toEqual(session.rounds);
    expect(finished.session.rounds[0].matches[0].lineupA).toEqual(match.lineupA);
    expect(finished.session.rounds[0].matches[0].lineupB).toEqual(match.lineupB);
    expect(finished.session.rounds[0].matches[0]).toMatchObject({ scoreA: 21, scoreB: 18 });
    expect(finished.document.schemaVersion).toBe(TEAM_SESSION_SCHEMA_VERSION);
    expect(finished.document.sessions[1]).toEqual(otherSession);
    expect(canEnableFinalizeTeamSession(finished.session)).toBe(false);
    expect(original).toEqual(snapshot);

    expect(
      addSessionTeam(finished.document, 'session-1', ['p5'], { roster, now: LATER }).errors[0].code
    ).toBe('TEAMS_LOCKED');
    expect(
      startTeamSessionRoundRobin(finished.document, 'session-1', {
        roster,
        generateConfirmed: true,
      }).errors[0].code
    ).toBe('SESSION_NOT_DRAFT');
    expect(
      resetTeamSessionToDraftForTeamEditing(finished.document, 'session-1', {
        resetConfirmed: true,
      }).errors[0].code
    ).toBe('SESSION_FINISHED');
    expect(
      setTeamSessionMatchLineups(
        finished.document,
        'session-1',
        session.rounds[0].id,
        match.id,
        ['p1'],
        ['p3'],
        { roster }
      ).errors[0].code
    ).toBe('SESSION_FINISHED');
    const editedScore = setTeamSessionMatchScore(
      finished.document,
      'session-1',
      session.rounds[0].id,
      match.id,
      25,
      20,
      { now: LATER }
    );
    expect(editedScore.ok).toBe(true);
    expect(editedScore.session.status).toBe('finished');
    expect(editedScore.session.rounds[0].matches[0]).toMatchObject({ scoreA: 25, scoreB: 20 });
    expect(editedScore.session.teams).toEqual(session.teams);
    expect(editedScore.session.rounds[0].matches[0].lineupA).toEqual(match.lineupA);
    expect(
      clearTeamSessionMatchScore(finished.document, 'session-1', session.rounds[0].id, match.id, {
        clearConfirmed: true,
      }).errors[0].code
    ).toBe('SESSION_FINISHED');
  });

  it('aceita múltiplas rodadas e lineup incompleta, e rejeita estados inválidos', () => {
    const three = scoreEveryMatch(inProgressThreeTeams());
    const incompleteLineup = setTeamSessionMatchLineups(
      three,
      'session-1',
      three.sessions[0].rounds[0].id,
      three.sessions[0].rounds[0].matches[0].id,
      three.sessions[0].rounds[0].matches[0].lineupA.slice(0, 5).map((item) => item.playerId),
      three.sessions[0].rounds[0].matches[0].lineupB.map((item) => item.playerId),
      { roster: makeRoster(16), now: LATER }
    );
    expect(incompleteLineup.ok).toBe(true);
    expect(incompleteLineup.session.status).toBe('in_progress');
    expect(incompleteLineup.session.rounds[0].matches[0].scoreA).toBe(21);
    expect(canEnableFinalizeTeamSession(incompleteLineup.session)).toBe(true);

    const finished = finalizeTeamSession(incompleteLineup.document, 'session-1', {
      now: LATER,
      finalizeConfirmed: true,
    });
    expect(finished.ok).toBe(true);
    expect(finished.session.status).toBe('finished');
    expect(finished.session.rounds).toHaveLength(3);
    expect(countSessionMatches(finished.session)).toEqual({
      total: 3,
      completed: 3,
      pending: 0,
      invalid: 0,
    });
    expect(finished.session.rounds[0].matches[0].lineupA).toHaveLength(5);

    const pending = inProgressTwoTeams();
    expect(canEnableFinalizeTeamSession(pending.sessions[0])).toBe(false);
    expect(teamSessionFinalizeProgressLabel(pending.sessions[0])).toBe(
      '0 de 1 partidas concluídas'
    );
    expect(
      finalizeTeamSession(pending, 'session-1', { finalizeConfirmed: true }).errors[0].code
    ).toBe('FINALIZE_INCOMPLETE');

    const draft = documentWith(draftSession({ teams: twoTeams }));
    expect(
      finalizeTeamSession(draft, 'session-1', { finalizeConfirmed: true }).errors[0].code
    ).toBe('SESSION_NOT_IN_PROGRESS');
    expect(
      finalizeTeamSession(finished.document, 'session-1', { finalizeConfirmed: true }).errors[0]
        .code
    ).toBe('SESSION_FINISHED');
    expect(
      finalizeTeamSession(pending, 'missing', { finalizeConfirmed: true }).errors[0].code
    ).toBe('SESSION_NOT_FOUND');

    const emptyRounds = documentWith(
      draftSession({ status: 'in_progress', teams: twoTeams, rounds: [] })
    );
    expect(
      finalizeTeamSession(emptyRounds, 'session-1', { finalizeConfirmed: true }).errors[0].code
    ).toBe('FINALIZE_NO_MATCHES');

    const withInvalid = (scoreA, scoreB) => {
      const doc = JSON.parse(JSON.stringify(scoreEveryMatch(inProgressTwoTeams())));
      doc.sessions[0].rounds[0].matches[0].scoreA = scoreA;
      doc.sessions[0].rounds[0].matches[0].scoreB = scoreB;
      return finalizeTeamSession(doc, 'session-1', { finalizeConfirmed: true }).errors[0].code;
    };
    expect(withInvalid(21, 21)).toBe('FINALIZE_INCOMPLETE');
    expect(withInvalid(21, null)).toBe('FINALIZE_INCOMPLETE');
    expect(withInvalid(-1, 18)).toBe('FINALIZE_INCOMPLETE');
    expect(withInvalid(21.5, 18)).toBe('FINALIZE_INCOMPLETE');
  });
});

describe('edição e exclusão de encontros', () => {
  it('edita nome e data em draft, in_progress e finished sem mexer em times', () => {
    const teams = [team('team-1', [member('p1', 'Erik')])];
    const original = documentWith(draftSession({ teams }));
    const snapshot = JSON.parse(JSON.stringify(original.sessions[0].teams));
    const updated = updateTeamSessionDetails(
      original,
      'session-1',
      { date: '2026-09-13', name: '  QA Encontro  ' },
      { now: LATER }
    );

    expect(updated.ok).toBe(true);
    expect(updated.session.date).toBe('2026-09-13');
    expect(updated.session.name).toBe('QA Encontro');
    expect(updated.session.id).toBe('session-1');
    expect(updated.session.createdAt).toBe(ISO_CREATED);
    expect(updated.session.status).toBe('draft');
    expect(updated.session.teams).toEqual(snapshot);
    expect(updated.session.updatedAt).toBe('2026-09-12T20:00:00.000Z');
    expect(original.sessions[0].name).toBe('Arena');

    const live = documentWith(draftSession({ status: 'in_progress', teams, rounds: [] }));
    live.sessions[0].rounds = [
      {
        id: 'r1',
        number: 1,
        byeTeamId: null,
        matches: [
          {
            id: 'm1',
            teamAId: 'team-1',
            teamBId: 'team-2',
            lineupA: [member('p1', 'Erik')],
            lineupB: [member('p3', 'Gabi')],
            scoreA: null,
            scoreB: null,
          },
        ],
      },
    ];
    live.sessions[0].teams = [
      team('team-1', [member('p1', 'Erik'), member('p2', 'André')]),
      team('team-2', [member('p3', 'Gabi'), member('p4', 'Luiza')]),
    ];
    const liveUpdated = updateTeamSessionDetails(live, 'session-1', { name: '' }, { now: LATER });
    expect(liveUpdated.ok).toBe(true);
    expect(liveUpdated.session.name).toBeNull();
    expect(liveUpdated.session.status).toBe('in_progress');
    expect(liveUpdated.session.teams).toHaveLength(2);
    expect(liveUpdated.session.rounds).toHaveLength(1);

    const finished = JSON.parse(JSON.stringify(liveUpdated.document));
    finished.sessions[0].status = 'finished';
    finished.sessions[0].rounds[0].matches[0].scoreA = 21;
    finished.sessions[0].rounds[0].matches[0].scoreB = 18;
    const finishedUpdated = updateTeamSessionDetails(
      finished,
      'session-1',
      { date: '2026-09-14' },
      { now: LATER }
    );
    expect(finishedUpdated.ok).toBe(true);
    expect(finishedUpdated.session.date).toBe('2026-09-14');
    expect(finishedUpdated.session.status).toBe('finished');
    expect(finishedUpdated.session.rounds[0].matches[0]).toMatchObject({ scoreA: 21, scoreB: 18 });
  });

  it('não grava quando nada mudou', () => {
    const original = documentWith(draftSession());
    const result = updateTeamSessionDetails(
      original,
      'session-1',
      { date: '2026-09-12', name: 'Arena', teamSize: 2, teamCount: 2 },
      { now: LATER }
    );
    expect(result.ok).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.session.updatedAt).toBe(ISO_CREATED);
    expect(result.document).toBe(original);
  });

  it('altera formato de draft vazio sem confirmação e rejeita valores inválidos', () => {
    const original = documentWith(draftSession());
    const updated = updateTeamSessionDetails(
      original,
      'session-1',
      { teamSize: 4, teamCount: 3 },
      { now: LATER }
    );
    expect(updated.ok).toBe(true);
    expect(updated.session.format).toEqual({ teamSize: 4, teamCount: 3 });
    expect(updated.session.teams).toEqual([]);

    const badDate = updateTeamSessionDetails(original, 'session-1', { date: '12-09-2026' });
    expect(badDate.ok).toBe(false);
    expect(badDate.document).toBeNull();
    expect(original.sessions[0].date).toBe('2026-09-12');

    const badFormat = updateTeamSessionDetails(original, 'session-1', { teamSize: 7, teamCount: 2 });
    expect(badFormat.ok).toBe(false);
    expect(badFormat.document).toBeNull();
    expect(badFormat.errors[0].field).toBe('teamSize');

    const missing = updateTeamSessionDetails(original, 'missing', { name: 'X' });
    expect(missing.ok).toBe(false);
    expect(missing.errors[0].code).toBe('SESSION_NOT_FOUND');
    expect(missing.document).toBeNull();
  });

  it('exige confirmação para mudar formato de draft com times e cancela sem alterar', () => {
    const original = documentWith(
      draftSession({
        teams: [team('team-1', [member('p1', 'Erik')])],
      })
    );
    const pending = updateTeamSessionDetails(original, 'session-1', { teamSize: 3, teamCount: 2 });
    expect(pending.ok).toBe(false);
    expect(pending.errors[0].code).toBe(FORMAT_CHANGE_CONFIRMATION_REQUIRED);
    expect(pending.errors[0].message).toBe(FORMAT_CHANGE_CONFIRMATION_MESSAGE);
    expect(pending.document).toBeNull();
    expect(original.sessions[0].teams).toHaveLength(1);

    const confirmed = updateTeamSessionDetails(
      original,
      'session-1',
      { teamSize: 3, teamCount: 2 },
      { formatChangeConfirmed: true, now: LATER }
    );
    expect(confirmed.ok).toBe(true);
    expect(confirmed.session.format).toEqual({ teamSize: 3, teamCount: 2 });
    expect(confirmed.session.teams).toEqual([]);
    expect(confirmed.session.rounds).toEqual([]);
    expect(confirmed.session.id).toBe('session-1');
    expect(confirmed.session.createdAt).toBe(ISO_CREATED);
    expect(original.sessions[0].teams).toHaveLength(1);
  });

  it('bloqueia mudança de formato fora de draft', () => {
    const live = documentWith(draftSession({ status: 'in_progress' }));
    expect(updateTeamSessionDetails(live, 'session-1', { teamSize: 4 }).errors[0].code).toBe(
      'FORMAT_LOCKED'
    );

    const original = documentWith(draftSession({ status: 'finished' }));
    const result = updateTeamSessionDetails(original, 'session-1', { teamSize: 4 });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('FORMAT_LOCKED');
    expect(result.document).toBeNull();
  });

  it('exclui somente a sessão confirmada e preserva as demais', () => {
    const original = documentWith(draftSession(), [draftSession({ id: 'session-2', name: 'Outro' })]);
    const pending = deleteTeamSession(original, 'session-1');
    expect(pending.ok).toBe(false);
    expect(pending.errors[0].code).toBe(DELETE_TEAM_SESSION_CONFIRMATION_REQUIRED);
    expect(pending.document).toBeNull();
    expect(original.sessions).toHaveLength(2);

    const missing = deleteTeamSession(original, 'missing', { deleteConfirmed: true });
    expect(missing.ok).toBe(false);
    expect(missing.errors[0].code).toBe('SESSION_NOT_FOUND');
    expect(missing.document).toBeNull();
    expect(original.sessions).toHaveLength(2);

    const confirmed = deleteTeamSession(original, 'session-1', { deleteConfirmed: true });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.document.schemaVersion).toBe(2);
    expect(confirmed.document.sessions.map((session) => session.id)).toEqual(['session-2']);
    expect(original.sessions).toHaveLength(2);
  });
});

describe('snapshots órfãos após exclusão do elenco', () => {
  it('preserva snapshot em draft, in_progress e finished e some das novas seleções', () => {
    const draft = documentWith(
      draftSession({
        format: { teamSize: 2, teamCount: 3 },
        teams: [
          team('team-1', [member('p1', 'Erik antigo')]),
          team('team-2', [member('p3', 'Gabi')]),
        ],
      })
    );
    const reducedRoster = roster.filter((player) => player.id !== 'p1');
    const snapshot = JSON.parse(JSON.stringify(draft.sessions[0].teams));

    expect(availablePlayersForTeams(reducedRoster, draft.sessions[0].teams).map((player) => player.id)).not.toContain(
      'p1'
    );
    expect(availablePlayersForTeams(reducedRoster, []).map((player) => player.id)).not.toContain('p1');
    expect(availablePlayersForTeams(reducedRoster, []).map((player) => player.id)).toContain('p3');

    const keptTeam = updateSessionTeam(draft, 'session-1', 'team-1', ['p1'], {
      roster: reducedRoster,
      now: LATER,
    });
    expect(keptTeam.ok).toBe(true);
    expect(keptTeam.session.teams[0].members).toEqual([member('p1', 'Erik antigo')]);
    expect(draft.sessions[0].teams).toEqual(snapshot);

    const added = addSessionTeam(
      documentWith(
        draftSession({
          teams: [team('team-2', [member('p3', 'Gabi')])],
        })
      ),
      'session-1',
      ['p1'],
      { roster: reducedRoster, now: LATER }
    );
    expect(added.ok).toBe(false);
    expect(added.errors[0].code).toBe('TEAM_PLAYER_NOT_FOUND');
    expect(added.document).toBeNull();

    const live = startTeamSessionRoundRobin(
      documentWith(
        draftSession({
          format: { teamSize: 2, teamCount: 4 },
          teams: [
            team('team-1', [member('p1', 'Erik antigo'), member('p2', 'André')]),
            team('team-2', [member('p3', 'Gabi'), member('p4', 'Luiza')]),
            team('team-3', [member('p5', 'Ian'), member('p6', 'Ana')]),
            team('team-4', [member('p7', 'BH'), member('p8', 'Arthur')]),
          ],
        })
      ),
      'session-1',
      { roster: reducedRoster, idGenerator: sequentialIds(), now: NOW, generateConfirmed: true }
    );
    expect(live.ok).toBe(true);
    expect(live.session.status).toBe('in_progress');
    expect(live.session.teams[0].members[0]).toEqual(member('p1', 'Erik antigo'));
    const firstMatch = allMatches(live.session.rounds).find(
      (match) => match.teamAId === 'team-1' || match.teamBId === 'team-1'
    );
    const firstLineup =
      firstMatch.teamAId === 'team-1' ? firstMatch.lineupA : firstMatch.lineupB;
    expect(firstLineup[0]).toEqual(member('p1', 'Erik antigo'));

    const otherMatch = allMatches(live.session.rounds).find((match) => match.id !== firstMatch.id);
    const editedOther = setTeamSessionMatchLineups(
      live.document,
      'session-1',
      live.session.rounds.find((round) => round.matches.some((match) => match.id === otherMatch.id)).id,
      otherMatch.id,
      otherMatch.lineupA.map((item) => item.playerId),
      otherMatch.lineupB.map((item) => item.playerId),
      { roster: reducedRoster, now: LATER }
    );
    expect(editedOther.ok).toBe(true);
    expect(editedOther.session.teams[0].members[0]).toEqual(member('p1', 'Erik antigo'));
    const keptFirst = allMatches(editedOther.session.rounds).find((match) => match.id === firstMatch.id);
    const keptLineup = keptFirst.teamAId === 'team-1' ? keptFirst.lineupA : keptFirst.lineupB;
    expect(keptLineup[0]).toEqual(member('p1', 'Erik antigo'));

    const renamed = updateTeamSessionDetails(
      editedOther.document,
      'session-1',
      { name: 'QA Snapshot' },
      { now: LATER }
    );
    expect(renamed.session.teams[0].members[0]).toEqual(member('p1', 'Erik antigo'));

    let scored = editedOther.document;
    for (const round of scored.sessions[0].rounds) {
      for (const match of round.matches) {
        scored = setTeamSessionMatchScore(scored, 'session-1', round.id, match.id, 21, 18, {
          now: LATER,
        }).document;
      }
    }
    const finished = finalizeTeamSession(scored, 'session-1', {
      finalizeConfirmed: true,
      now: LATER,
    });
    expect(finished.ok).toBe(true);
    expect(finished.session.status).toBe('finished');
    expect(finished.session.teams[0].members[0]).toEqual(member('p1', 'Erik antigo'));
  });
});
