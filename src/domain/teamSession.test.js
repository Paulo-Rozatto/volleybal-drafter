import { describe, expect, it } from 'vitest';
import {
  TEAM_SESSION_SCHEMA_VERSION,
  cloneTeamMembers,
  createInitialLineups,
  validateFormat,
  validateLineup,
  validateMatchLineups,
  validateSessionTeams,
  validateTeam,
  validateTeamCount,
  validateV2Document,
  validateV2Session,
} from './teamSession.js';

const roster = [
  { id: 'p1', name: 'Erik' },
  { id: 'p2', name: 'André' },
  { id: 'p3', name: 'Gabi' },
  { id: 'p4', name: 'Luiza' },
  { id: 'p5', name: 'Ian' },
  { id: 'p6', name: 'Ana' },
  { id: 'p7', name: 'BH' },
  { id: 'p8', name: 'Arthur' },
];

function member(playerId, playerName) {
  return { playerId, playerName };
}

function team(id, members) {
  return { id, members };
}

describe('validateFormat', () => {
  it('aceita formatos 2x2 até 6x6', () => {
    for (const teamSize of [2, 3, 4, 5, 6]) {
      expect(validateFormat({ teamSize, teamCount: 2 }).ok).toBe(true);
    }
  });

  it('aceita teamCount explícito e não deriva do elenco', () => {
    expect(validateFormat({ teamSize: 2, teamCount: 5 }).ok).toBe(true);
    expect(validateFormat({ teamSize: 6, teamCount: 3 }).ok).toBe(true);
    expect(roster).toHaveLength(8);
  });

  it('rejeita formato ausente ou malformado', () => {
    expect(validateFormat(null).errors[0].code).toBe('FORMAT_REQUIRED');
    expect(validateFormat(undefined).errors[0].code).toBe('FORMAT_REQUIRED');
    expect(validateFormat('6x6').errors[0].code).toBe('FORMAT_INVALID');
    expect(validateFormat([]).errors[0].code).toBe('FORMAT_INVALID');
  });

  it('rejeita teamSize fora de 2–6', () => {
    expect(validateFormat({ teamSize: 1, teamCount: 2 }).errors[0].code).toBe('TEAM_SIZE_INVALID');
    expect(validateFormat({ teamSize: 7, teamCount: 2 }).errors[0].code).toBe('TEAM_SIZE_INVALID');
    expect(validateFormat({ teamSize: 2.5, teamCount: 2 }).errors[0].code).toBe('TEAM_SIZE_INVALID');
  });

  it('rejeita teamCount menor que 2', () => {
    expect(validateFormat({ teamSize: 2, teamCount: 1 }).errors[0].code).toBe('TEAM_COUNT_INVALID');
    expect(validateFormat({ teamSize: 2, teamCount: 0 }).errors[0].code).toBe('TEAM_COUNT_INVALID');
    expect(validateFormat({ teamSize: 2, teamCount: 1.5 }).errors[0].code).toBe('TEAM_COUNT_INVALID');
  });
});

describe('validateTeam e validateSessionTeams', () => {
  const format = { teamSize: 6, teamCount: 2 };

  it('aceita time completo, incompleto e vazio em draft', () => {
    expect(validateTeam(team('t1', [member('p1', 'Erik'), member('p2', 'André')]), format, roster).ok).toBe(true);
    expect(
      validateTeam(
        team('t1', [
          member('p1', 'Erik'),
          member('p2', 'André'),
          member('p3', 'Gabi'),
          member('p4', 'Luiza'),
          member('p5', 'Ian'),
          member('p6', 'Ana'),
        ]),
        format,
        roster
      ).ok
    ).toBe(true);
    expect(validateTeam(team('t1', []), format, roster).ok).toBe(true);
  });

  it('rejeita capacidade excedida', () => {
    const oversized = team('t1', [
      member('p1', 'Erik'),
      member('p2', 'André'),
      member('p3', 'Gabi'),
    ]);
    expect(validateTeam(oversized, { teamSize: 2, teamCount: 2 }, roster).errors[0].code).toBe(
      'TEAM_CAPACITY_EXCEEDED'
    );
  });

  it('rejeita ID ausente, vazio ou duplicado', () => {
    expect(validateTeam({ members: [] }, format, roster).errors[0].code).toBe('TEAM_ID_INVALID');
    expect(validateTeam(team('  ', []), format, roster).errors[0].code).toBe('TEAM_ID_INVALID');
    expect(
      validateTeam(team('t1', []), format, roster, [team('t1', [member('p1', 'Erik')])]).errors[0].code
    ).toBe('TEAM_ID_DUPLICATE');
  });

  it('rejeita jogador repetido no mesmo time e em dois times-base', () => {
    expect(
      validateTeam(team('t1', [member('p1', 'Erik'), member('p1', 'Erik')]), format, roster).errors.some(
        (item) => item.code === 'TEAM_DUPLICATE_PLAYER'
      )
    ).toBe(true);

    const result = validateSessionTeams(
      [team('t1', [member('p1', 'Erik')]), team('t2', [member('p1', 'Erik')])],
      { teamSize: 2, teamCount: 2 },
      roster
    );
    expect(result.errors.some((item) => item.code === 'TEAM_PLAYER_ALREADY_ASSIGNED')).toBe(true);
  });

  it('rejeita jogador inexistente no elenco', () => {
    expect(
      validateTeam(team('t1', [member('missing', 'Ghost')]), format, roster).errors[0].code
    ).toBe('TEAM_PLAYER_NOT_FOUND');
  });

  it('aceita snapshot órfão já existente mesmo fora do elenco atual', () => {
    const orphan = team('t1', [member('missing', 'Ghost')]);
    expect(
      validateTeam(orphan, format, roster, [], { existingMemberIds: ['missing'] }).ok
    ).toBe(true);
    expect(
      validateV2Document(
        {
          schemaVersion: 2,
          sessions: [
            {
              id: 'session-1',
              date: '2026-09-12',
              name: null,
              status: 'draft',
              createdAt: '2026-09-12T18:00:00.000Z',
              updatedAt: '2026-09-12T18:00:00.000Z',
              format: { teamSize: 2, teamCount: 2 },
              teams: [orphan, team('t2', [])],
              rounds: [],
            },
          ],
        },
        roster
      ).ok
    ).toBe(true);
  });

  it('rejeita quantidade de times diferente do teamCount explícito', () => {
    const result = validateTeamCount([team('t1', []), team('t2', []), team('t3', [])], {
      teamSize: 2,
      teamCount: 2,
    });
    expect(result.errors[0].code).toBe('TEAM_COUNT_MISMATCH');
    expect(
      validateSessionTeams([team('t1', []), team('t2', [])], { teamSize: 2, teamCount: 3 }, roster).errors[0]
        .code
    ).toBe('TEAM_COUNT_MISMATCH');
  });
});

describe('validateLineup e validateMatchLineups', () => {
  const format = { teamSize: 6, teamCount: 3 };
  const teams = [
    team('t1', [member('p1', 'Erik'), member('p2', 'André')]),
    team('t2', [member('p3', 'Gabi'), member('p4', 'Luiza')]),
    team('t3', [member('p5', 'Ian'), member('p6', 'Ana')]),
  ];

  it('aceita lineup completa e incompleta', () => {
    expect(validateLineup([member('p1', 'Erik')], format, roster).ok).toBe(true);
    expect(
      validateLineup(
        [
          member('p1', 'Erik'),
          member('p2', 'André'),
          member('p3', 'Gabi'),
          member('p4', 'Luiza'),
          member('p5', 'Ian'),
          member('p6', 'Ana'),
        ],
        format,
        roster
      ).ok
    ).toBe(true);
  });

  it('rejeita lineup vazia, acima da capacidade, repetida ou com jogador inexistente', () => {
    expect(validateLineup([], format, roster).errors[0].code).toBe('LINEUP_EMPTY');
    expect(
      validateLineup(
        [
          member('p1', 'Erik'),
          member('p2', 'André'),
          member('p3', 'Gabi'),
          member('p4', 'Luiza'),
          member('p5', 'Ian'),
          member('p6', 'Ana'),
          member('p7', 'BH'),
        ],
        format,
        roster
      ).errors[0].code
    ).toBe('LINEUP_CAPACITY_EXCEEDED');
    expect(
      validateLineup([member('p1', 'Erik'), member('p1', 'Erik')], format, roster).errors.some(
        (item) => item.code === 'LINEUP_DUPLICATE_PLAYER'
      )
    ).toBe(true);
    expect(validateLineup([member('missing', 'Ghost')], format, roster).errors[0].code).toBe(
      'LINEUP_PLAYER_NOT_FOUND'
    );
  });

  it('aceita jogador emprestado de terceiro time sem alterar o time-base', () => {
    const snapshot = JSON.parse(JSON.stringify(teams));
    const match = {
      id: 'm1',
      teamAId: 't1',
      teamBId: 't2',
      lineupA: [member('p1', 'Erik'), member('p5', 'Ian')],
      lineupB: [member('p3', 'Gabi')],
      scoreA: 21,
      scoreB: 18,
    };

    expect(validateMatchLineups(match, format, teams, roster).ok).toBe(true);
    expect(teams).toEqual(snapshot);
    expect(teams[2].members).toEqual([member('p5', 'Ian'), member('p6', 'Ana')]);
  });

  it('rejeita o mesmo jogador nos dois lados da mesma partida', () => {
    const result = validateMatchLineups(
      {
        id: 'm1',
        teamAId: 't1',
        teamBId: 't2',
        lineupA: [member('p1', 'Erik')],
        lineupB: [member('p1', 'Erik')],
      },
      format,
      teams,
      roster
    );
    expect(result.errors.some((item) => item.code === 'MATCH_PLAYER_BOTH_SIDES')).toBe(true);
  });

  it('rejeita teamAId igual a teamBId e time inexistente', () => {
    expect(
      validateMatchLineups(
        {
          teamAId: 't1',
          teamBId: 't1',
          lineupA: [member('p1', 'Erik')],
          lineupB: [member('p2', 'André')],
        },
        format,
        teams,
        roster
      ).errors[0].code
    ).toBe('MATCH_SAME_TEAM');

    expect(
      validateMatchLineups(
        {
          teamAId: 't1',
          teamBId: 'missing',
          lineupA: [member('p1', 'Erik')],
          lineupB: [member('p3', 'Gabi')],
        },
        format,
        teams,
        roster
      ).errors.some((item) => item.code === 'MATCH_TEAM_NOT_FOUND')
    ).toBe(true);
  });
});

describe('createInitialLineups', () => {
  it('copia membros de forma independente, sem completar o time', () => {
    const teamA = team('t1', [member('p1', 'Erik')]);
    const teamB = team('t2', [member('p3', 'Gabi'), member('p4', 'Luiza')]);
    const lineups = createInitialLineups(teamA, teamB);

    expect(lineups.lineupA).toEqual([member('p1', 'Erik')]);
    expect(lineups.lineupB).toEqual([member('p3', 'Gabi'), member('p4', 'Luiza')]);
    expect(lineups.lineupA).not.toBe(teamA.members);
    expect(lineups.lineupA[0]).not.toBe(teamA.members[0]);
    expect(cloneTeamMembers(teamA.members)).not.toBe(teamA.members);

    lineups.lineupA[0].playerName = 'Alterado';
    lineups.lineupB.push(member('p5', 'Ian'));
    expect(teamA.members[0].playerName).toBe('Erik');
    expect(teamB.members).toHaveLength(2);
  });
});

describe('validateV2Session', () => {
  it('aceita o mesmo jogador em partidas diferentes da mesma rodada', () => {
    const format = { teamSize: 2, teamCount: 4 };
    const session = {
      id: 's1',
      date: '2026-09-12',
      name: null,
      status: 'in_progress',
      createdAt: '2026-09-12T18:00:00.000Z',
      updatedAt: '2026-09-12T18:00:00.000Z',
      format,
      teams: [
        team('t1', [member('p1', 'Erik'), member('p2', 'André')]),
        team('t2', [member('p3', 'Gabi'), member('p4', 'Luiza')]),
        team('t3', [member('p5', 'Ian'), member('p6', 'Ana')]),
        team('t4', [member('p7', 'BH'), member('p8', 'Arthur')]),
      ],
      rounds: [
        {
          id: 'r1',
          number: 1,
          byeTeamId: null,
          matches: [
            {
              id: 'm1',
              teamAId: 't1',
              teamBId: 't2',
              lineupA: [member('p1', 'Erik')],
              lineupB: [member('p3', 'Gabi')],
              scoreA: null,
              scoreB: null,
            },
            {
              id: 'm2',
              teamAId: 't3',
              teamBId: 't4',
              lineupA: [member('p1', 'Erik')],
              lineupB: [member('p7', 'BH')],
              scoreA: null,
              scoreB: null,
            },
          ],
        },
      ],
    };

    expect(validateV2Session(session, roster).ok).toBe(true);
  });
});

const ISO = '2026-09-12T18:00:00.000Z';

function memberPair(idA, nameA, idB, nameB) {
  return [member(idA, nameA), member(idB, nameB)];
}

function draftSession(overrides = {}) {
  return {
    id: 'session-1',
    date: '2026-09-12',
    name: 'Arena',
    status: 'draft',
    createdAt: ISO,
    updatedAt: ISO,
    format: { teamSize: 2, teamCount: 2 },
    teams: [],
    rounds: [],
    ...overrides,
  };
}

function inProgressSession(overrides = {}) {
  return draftSession({
    status: 'in_progress',
    teams: [
      team('t1', memberPair('p1', 'Erik', 'p2', 'André')),
      team('t2', memberPair('p3', 'Gabi', 'p4', 'Luiza')),
    ],
    rounds: [
      {
        id: 'round-1',
        number: 1,
        byeTeamId: null,
        matches: [
          {
            id: 'match-1',
            teamAId: 't1',
            teamBId: 't2',
            lineupA: memberPair('p1', 'Erik', 'p2', 'André'),
            lineupB: memberPair('p3', 'Gabi', 'p4', 'Luiza'),
            scoreA: null,
            scoreB: null,
          },
        ],
      },
    ],
    ...overrides,
  });
}

function finishedSession(overrides = {}) {
  return inProgressSession({
    status: 'finished',
    rounds: [
      {
        id: 'round-1',
        number: 1,
        byeTeamId: null,
        matches: [
          {
            id: 'match-1',
            teamAId: 't1',
            teamBId: 't2',
            lineupA: memberPair('p1', 'Erik', 'p2', 'André'),
            lineupB: memberPair('p3', 'Gabi', 'p4', 'Luiza'),
            scoreA: 21,
            scoreB: 18,
          },
        ],
      },
    ],
    ...overrides,
  });
}

function documentOf(session) {
  return { schemaVersion: TEAM_SESSION_SCHEMA_VERSION, sessions: [session] };
}

function errorCodes(result) {
  return (result.errors ?? []).map((item) => item.code);
}

describe('validateV2Document', () => {
  it('aceita schema 2 e rejeita versão diferente', () => {
    expect(validateV2Document({ schemaVersion: TEAM_SESSION_SCHEMA_VERSION, sessions: [] }).ok).toBe(true);
    expect(validateV2Document({ schemaVersion: 1, sessions: [] }).errors[0].code).toBe(
      'SCHEMA_VERSION_UNSUPPORTED'
    );
  });

  it('aceita documento válido em draft, in_progress e finished', () => {
    expect(validateV2Document(documentOf(draftSession())).ok).toBe(true);
    expect(validateV2Document(documentOf(inProgressSession())).ok).toBe(true);
    expect(validateV2Document(documentOf(finishedSession())).ok).toBe(true);
  });

  it('rejeita status inválido', () => {
    expect(errorCodes(validateV2Document(documentOf(draftSession({ status: 'archived' }))))).toContain(
      'SESSION_STATUS_INVALID'
    );
  });

  it('rejeita sessão duplicada', () => {
    const result = validateV2Document({
      schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
      sessions: [draftSession(), draftSession({ name: 'Outro' })],
    });
    expect(errorCodes(result)).toContain('SESSION_ID_DUPLICATE');
  });

  it('rejeita rodada duplicada', () => {
    const session = inProgressSession({
      rounds: [
        {
          id: 'round-1',
          number: 1,
          byeTeamId: null,
          matches: [
            {
              id: 'match-1',
              teamAId: 't1',
              teamBId: 't2',
              lineupA: memberPair('p1', 'Erik', 'p2', 'André'),
              lineupB: memberPair('p3', 'Gabi', 'p4', 'Luiza'),
              scoreA: null,
              scoreB: null,
            },
          ],
        },
        {
          id: 'round-1',
          number: 2,
          byeTeamId: null,
          matches: [
            {
              id: 'match-2',
              teamAId: 't1',
              teamBId: 't2',
              lineupA: memberPair('p1', 'Erik', 'p2', 'André'),
              lineupB: memberPair('p3', 'Gabi', 'p4', 'Luiza'),
              scoreA: null,
              scoreB: null,
            },
          ],
        },
      ],
    });
    expect(errorCodes(validateV2Document(documentOf(session)))).toContain('ROUND_ID_DUPLICATE');
  });

  it('rejeita partida duplicada', () => {
    const session = inProgressSession({
      rounds: [
        {
          id: 'round-1',
          number: 1,
          byeTeamId: null,
          matches: [
            {
              id: 'match-1',
              teamAId: 't1',
              teamBId: 't2',
              lineupA: memberPair('p1', 'Erik', 'p2', 'André'),
              lineupB: memberPair('p3', 'Gabi', 'p4', 'Luiza'),
              scoreA: null,
              scoreB: null,
            },
            {
              id: 'match-1',
              teamAId: 't2',
              teamBId: 't1',
              lineupA: memberPair('p3', 'Gabi', 'p4', 'Luiza'),
              lineupB: memberPair('p1', 'Erik', 'p2', 'André'),
              scoreA: null,
              scoreB: null,
            },
          ],
        },
      ],
    });
    expect(errorCodes(validateV2Document(documentOf(session)))).toContain('MATCH_ID_DUPLICATE');
  });

  it('rejeita colisão entre ID de rodada e partida', () => {
    const session = inProgressSession({
      rounds: [
        {
          id: 'shared-id',
          number: 1,
          byeTeamId: null,
          matches: [
            {
              id: 'shared-id',
              teamAId: 't1',
              teamBId: 't2',
              lineupA: memberPair('p1', 'Erik', 'p2', 'André'),
              lineupB: memberPair('p3', 'Gabi', 'p4', 'Luiza'),
              scoreA: null,
              scoreB: null,
            },
          ],
        },
      ],
    });
    expect(errorCodes(validateV2Document(documentOf(session)))).toContain('ROUND_MATCH_ID_COLLISION');
  });

  it('rejeita número de rodada inválido ou duplicado', () => {
    expect(
      errorCodes(
        validateV2Document(
          documentOf(
            inProgressSession({
              rounds: [
                {
                  id: 'round-1',
                  number: 0,
                  byeTeamId: null,
                  matches: [
                    {
                      id: 'match-1',
                      teamAId: 't1',
                      teamBId: 't2',
                      lineupA: memberPair('p1', 'Erik', 'p2', 'André'),
                      lineupB: memberPair('p3', 'Gabi', 'p4', 'Luiza'),
                      scoreA: null,
                      scoreB: null,
                    },
                  ],
                },
              ],
            })
          )
        )
      )
    ).toContain('ROUND_NUMBER_INVALID');

    expect(
      errorCodes(
        validateV2Document(
          documentOf(
            inProgressSession({
              rounds: [
                {
                  id: 'round-1',
                  number: 1,
                  byeTeamId: null,
                  matches: [
                    {
                      id: 'match-1',
                      teamAId: 't1',
                      teamBId: 't2',
                      lineupA: memberPair('p1', 'Erik', 'p2', 'André'),
                      lineupB: memberPair('p3', 'Gabi', 'p4', 'Luiza'),
                      scoreA: null,
                      scoreB: null,
                    },
                  ],
                },
                {
                  id: 'round-2',
                  number: 1,
                  byeTeamId: null,
                  matches: [
                    {
                      id: 'match-2',
                      teamAId: 't1',
                      teamBId: 't2',
                      lineupA: memberPair('p1', 'Erik', 'p2', 'André'),
                      lineupB: memberPair('p3', 'Gabi', 'p4', 'Luiza'),
                      scoreA: null,
                      scoreB: null,
                    },
                  ],
                },
              ],
            })
          )
        )
      )
    ).toContain('ROUND_NUMBER_DUPLICATE');
  });

  it('rejeita placares parciais, negativos, decimais ou empatados', () => {
    const withScore = (scoreA, scoreB) =>
      errorCodes(
        validateV2Document(
          documentOf(
            inProgressSession({
              rounds: [
                {
                  id: 'round-1',
                  number: 1,
                  byeTeamId: null,
                  matches: [
                    {
                      id: 'match-1',
                      teamAId: 't1',
                      teamBId: 't2',
                      lineupA: memberPair('p1', 'Erik', 'p2', 'André'),
                      lineupB: memberPair('p3', 'Gabi', 'p4', 'Luiza'),
                      scoreA,
                      scoreB,
                    },
                  ],
                },
              ],
            })
          )
        )
      );

    expect(withScore(21, null)).toContain('SCORE_PARTIAL');
    expect(withScore(-1, 21)).toContain('SCORE_NEGATIVE');
    expect(withScore(21.5, 18)).toContain('SCORE_NOT_INTEGER');
    expect(withScore(21, 21)).toContain('SCORE_TIE');
  });

  it('rejeita draft com rodadas, in_progress sem partidas e finished incompleto', () => {
    expect(errorCodes(validateV2Document(documentOf(inProgressSession({ status: 'draft' }))))).toContain(
      'DRAFT_HAS_ROUNDS'
    );
    expect(
      errorCodes(validateV2Document(documentOf(draftSession({ status: 'in_progress' }))))
    ).toContain('IN_PROGRESS_NO_MATCHES');
    expect(
      errorCodes(validateV2Document(documentOf(inProgressSession({ status: 'finished' }))))
    ).toContain('FINALIZE_INCOMPLETE');
  });

  it('rejeita documento híbrido V1/V2', () => {
    expect(errorCodes(validateV2Document(documentOf(draftSession({ pairs: [] }))))).toContain(
      'DOCUMENT_HYBRID'
    );
  });

  it('rejeita teamAId igual a teamBId e referências inexistentes', () => {
    expect(
      errorCodes(
        validateV2Document(
          documentOf(
            inProgressSession({
              rounds: [
                {
                  id: 'round-1',
                  number: 1,
                  byeTeamId: null,
                  matches: [
                    {
                      id: 'match-1',
                      teamAId: 't1',
                      teamBId: 't1',
                      lineupA: memberPair('p1', 'Erik', 'p2', 'André'),
                      lineupB: memberPair('p3', 'Gabi', 'p4', 'Luiza'),
                      scoreA: null,
                      scoreB: null,
                    },
                  ],
                },
              ],
            })
          )
        )
      )
    ).toContain('MATCH_SAME_TEAM');

    expect(
      errorCodes(
        validateV2Document(
          documentOf(
            inProgressSession({
              rounds: [
                {
                  id: 'round-1',
                  number: 1,
                  byeTeamId: 'missing',
                  matches: [
                    {
                      id: 'match-1',
                      teamAId: 't1',
                      teamBId: 'ghost',
                      lineupA: memberPair('p1', 'Erik', 'p2', 'André'),
                      lineupB: memberPair('p3', 'Gabi', 'p4', 'Luiza'),
                      scoreA: null,
                      scoreB: null,
                    },
                  ],
                },
              ],
            })
          )
        )
      )
    ).toEqual(expect.arrayContaining(['BYE_TEAM_NOT_FOUND', 'MATCH_TEAM_NOT_FOUND']));
  });

  it('rejeita timestamps ausentes', () => {
    expect(errorCodes(validateV2Document(documentOf(draftSession({ createdAt: '' }))))).toContain(
      'CREATED_AT_INVALID'
    );
    expect(errorCodes(validateV2Document(documentOf(draftSession({ updatedAt: null }))))).toContain(
      'UPDATED_AT_INVALID'
    );
  });
});
