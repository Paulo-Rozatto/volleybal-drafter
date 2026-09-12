import { describe, expect, it } from 'vitest';
import { TEAM_SESSION_SCHEMA_VERSION } from './domain/teamSession.js';
import { countSessionMatches } from './domain/sessionValidation.js';
import {
  addSessionTeam,
  appendDraftTeamSession,
  availablePlayersForTeams,
  canEditSessionTeams,
  canGenerateTeamSessionRounds,
  createDraftTeamSession,
  removeSessionTeam,
  replaceSessionTeams,
  resetTeamSessionToDraftForTeamEditing,
  startTeamSessionRoundRobin,
  takenTeamPlayerIds,
  teamMemberIdsInRoster,
  teamSessionIsReadyToFinalize,
  updateSessionTeam,
  setTeamSessionMatchScore,
  clearTeamSessionMatchScore,
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
