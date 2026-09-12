import { describe, expect, it } from 'vitest';
import { validateSessionPairs } from './domain/sessionValidation.js';
import {
  addSessionPair,
  availableRosterPlayers,
  canEditSessionPairs,
  pairMembersForEdit,
  pairMemberIdsInRoster,
  removeSessionPair,
  replaceSessionPairs,
  takenPlayerIds,
  updateSessionPair,
} from './gameSessions.js';

const NOW = () => new Date('2026-09-12T19:00:00.000Z');
const LATER = () => new Date('2026-09-12T20:00:00.000Z');
const ISO_CREATED = '2026-09-12T18:00:00.000Z';
const ISO_UPDATED = '2026-09-12T19:00:00.000Z';

const roster = [
  { id: 'p1', name: 'Erik', score: 4, gender: 'M', height: 'tall' },
  { id: 'p2', name: 'André', score: 3, gender: 'M', height: 'tall' },
  { id: 'p3', name: 'Gabi', score: 4, gender: 'F', height: 'short' },
  { id: 'p4', name: 'Luiza', score: 3, gender: 'F', height: 'short' },
];

function draftSession(overrides = {}) {
  return {
    id: 'session-1',
    date: '2026-09-12',
    name: 'Arena',
    status: 'draft',
    createdAt: ISO_CREATED,
    updatedAt: ISO_CREATED,
    pairs: [],
    rounds: [],
    ...overrides,
  };
}

function documentWith(session, extraSessions = []) {
  return {
    schemaVersion: 1,
    sessions: [session, ...extraSessions],
  };
}

function memberNames(pair) {
  return pair.members.map((member) => member.playerName);
}

describe('addSessionPair', () => {
  it('adiciona uma dupla válida com snapshot dos nomes', () => {
    const original = documentWith(draftSession());
    const originalPairs = original.sessions[0].pairs;
    const other = draftSession({ id: 'session-2', name: 'Outro' });
    const withOther = documentWith(original.sessions[0], [other]);

    const result = addSessionPair(
      withOther,
      'session-1',
      { playerA: roster[0], playerB: roster[1] },
      roster,
      { idGenerator: () => 'pair-1', now: NOW }
    );

    expect(result.ok).toBe(true);
    expect(result.pair).toEqual({
      id: 'pair-1',
      members: [
        { playerId: 'p1', playerName: 'Erik' },
        { playerId: 'p2', playerName: 'André' },
      ],
    });
    expect(result.pair.members[0]).not.toHaveProperty('score');
    expect(result.session.status).toBe('draft');
    expect(result.session.rounds).toEqual([]);
    expect(result.session.createdAt).toBe(ISO_CREATED);
    expect(result.session.updatedAt).toBe(ISO_UPDATED);
    expect(result.document.schemaVersion).toBe(1);
    expect(result.document.sessions[1]).toEqual(other);
    expect(validateSessionPairs(result.session.pairs, roster).ok).toBe(true);
    expect(withOther.sessions[0].pairs).toBe(originalPairs);
    expect(withOther.sessions[0].pairs).toEqual([]);
    expect(withOther.sessions[0].updatedAt).toBe(ISO_CREATED);
  });

  it('aceita idGenerator e relógio injetáveis', () => {
    const result = addSessionPair(
      documentWith(draftSession()),
      'session-1',
      { playerA: roster[2], playerB: roster[3] },
      roster,
      { idGenerator: () => 'injected-pair', now: LATER }
    );

    expect(result.pair.id).toBe('injected-pair');
    expect(result.session.updatedAt).toBe('2026-09-12T20:00:00.000Z');
  });

  it('rejeita dois integrantes iguais', () => {
    const original = documentWith(draftSession());
    const result = addSessionPair(
      original,
      'session-1',
      { playerA: roster[0], playerB: roster[0] },
      roster,
      { idGenerator: () => 'pair-1', now: NOW }
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('PAIR_DUPLICATE_PLAYER');
    expect(original.sessions[0].pairs).toEqual([]);
  });

  it('rejeita jogador já utilizado', () => {
    const original = documentWith(
      draftSession({
        pairs: [
          {
            id: 'pair-1',
            members: [
              { playerId: 'p1', playerName: 'Erik' },
              { playerId: 'p2', playerName: 'André' },
            ],
          },
        ],
      })
    );

    const result = addSessionPair(
      original,
      'session-1',
      { playerA: roster[0], playerB: roster[2] },
      roster,
      { idGenerator: () => 'pair-2', now: NOW }
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('PAIR_PLAYER_ALREADY_PAIRED');
    expect(original.sessions[0].pairs).toHaveLength(1);
  });

  it('rejeita jogador inexistente', () => {
    const result = addSessionPair(
      documentWith(draftSession()),
      'session-1',
      { playerA: roster[0], playerB: { id: 'missing', name: 'Fantasma' } },
      roster,
      { idGenerator: () => 'pair-1', now: NOW }
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('PAIR_PLAYER_NOT_FOUND');
  });

  it('rejeita ID de dupla duplicado', () => {
    const original = documentWith(
      draftSession({
        pairs: [
          {
            id: 'pair-1',
            members: [
              { playerId: 'p1', playerName: 'Erik' },
              { playerId: 'p2', playerName: 'André' },
            ],
          },
        ],
      })
    );

    const result = addSessionPair(
      original,
      'session-1',
      { playerA: roster[2], playerB: roster[3] },
      roster,
      { idGenerator: () => 'pair-1', now: NOW }
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('PAIR_ID_DUPLICATE');
  });

  it('rejeita seleção incompleta', () => {
    const result = addSessionPair(
      documentWith(draftSession()),
      'session-1',
      { playerA: roster[0] },
      roster,
      { idGenerator: () => 'pair-1', now: NOW }
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('PAIR_SELECTION_INCOMPLETE');
  });

  it('impede alterações fora de draft', () => {
    const original = documentWith(draftSession({ status: 'in_progress' }));
    const result = addSessionPair(
      original,
      'session-1',
      { playerA: roster[0], playerB: roster[1] },
      roster,
      { idGenerator: () => 'pair-1', now: NOW }
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('PAIRS_LOCKED');
    expect(original.sessions[0].pairs).toEqual([]);
  });

  it('impede alterações quando já houver rodadas', () => {
    const original = documentWith(
      draftSession({
        rounds: [{ id: 'round-1', number: 1, matches: [] }],
      })
    );
    const result = addSessionPair(
      original,
      'session-1',
      { playerA: roster[0], playerB: roster[1] },
      roster,
      { idGenerator: () => 'pair-1', now: NOW }
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('PAIRS_LOCKED');
  });
});

describe('updateSessionPair', () => {
  const existing = draftSession({
    pairs: [
      {
        id: 'pair-1',
        members: [
          { playerId: 'p1', playerName: 'Erik antigo' },
          { playerId: 'p2', playerName: 'André antigo' },
        ],
      },
      {
        id: 'pair-2',
        members: [
          { playerId: 'p3', playerName: 'Gabi' },
          { playerId: 'p4', playerName: 'Luiza' },
        ],
      },
    ],
  });

  it('edita a dupla preservando pair.id e atualizando snapshots', () => {
    const original = documentWith(existing);
    const result = updateSessionPair(
      original,
      'session-1',
      'pair-1',
      { playerA: roster[0], playerB: { id: 'p2', name: 'André atual' } },
      [{ ...roster[0] }, { id: 'p2', name: 'André atual' }, roster[2], roster[3]],
      { now: NOW }
    );

    expect(result.ok).toBe(true);
    expect(result.pair.id).toBe('pair-1');
    expect(memberNames(result.pair)).toEqual(['Erik', 'André atual']);
    expect(result.session.createdAt).toBe(ISO_CREATED);
    expect(result.session.updatedAt).toBe(ISO_UPDATED);
    expect(original.sessions[0].pairs[0].members[1].playerName).toBe('André antigo');
    expect(validateSessionPairs(result.session.pairs, [
      roster[0],
      { id: 'p2', name: 'André atual' },
      roster[2],
      roster[3],
    ]).ok).toBe(true);
  });

  it('permite trocar um integrante sem conflitar com a própria dupla', () => {
    const original = documentWith(
      draftSession({
        pairs: [
          {
            id: 'pair-1',
            members: [
              { playerId: 'p1', playerName: 'Erik' },
              { playerId: 'p2', playerName: 'André' },
            ],
          },
        ],
      })
    );

    const result = updateSessionPair(
      original,
      'session-1',
      'pair-1',
      { playerA: roster[0], playerB: roster[2] },
      roster,
      { now: NOW }
    );

    expect(result.ok).toBe(true);
    expect(result.pair.members.map((member) => member.playerId)).toEqual(['p1', 'p3']);
    expect(original.sessions[0].pairs[0].members[1].playerId).toBe('p2');
  });

  it('permite trocar os dois integrantes', () => {
    const original = documentWith(
      draftSession({
        pairs: [
          {
            id: 'pair-1',
            members: [
              { playerId: 'p1', playerName: 'Erik' },
              { playerId: 'p2', playerName: 'André' },
            ],
          },
        ],
      })
    );

    const result = updateSessionPair(
      original,
      'session-1',
      'pair-1',
      { playerA: roster[2], playerB: roster[3] },
      roster,
      { now: NOW }
    );

    expect(result.ok).toBe(true);
    expect(result.pair.members.map((member) => member.playerId)).toEqual(['p3', 'p4']);
    expect(result.pair.id).toBe('pair-1');
  });

  it('rejeita edição que conflita com outra dupla', () => {
    const original = documentWith(existing);
    const result = updateSessionPair(
      original,
      'session-1',
      'pair-1',
      { playerA: roster[0], playerB: roster[2] },
      roster,
      { now: NOW }
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('PAIR_PLAYER_ALREADY_PAIRED');
    expect(original.sessions[0].pairs[0].members[1].playerId).toBe('p2');
  });

  it('não muta o documento ao preparar o cancelamento da edição', () => {
    const original = documentWith(existing);
    const preview = pairMembersForEdit(original.sessions[0].pairs[0], roster);
    expect(preview.map((player) => player.id)).toEqual(['p1', 'p2']);
    expect(original.sessions[0].pairs[0].members[0].playerName).toBe('Erik antigo');
    expect(original.sessions[0].updatedAt).toBe(ISO_CREATED);
  });
});

describe('removeSessionPair', () => {
  it('remove somente a dupla selecionada', () => {
    const keep = {
      id: 'pair-2',
      members: [
        { playerId: 'p3', playerName: 'Gabi' },
        { playerId: 'p4', playerName: 'Luiza' },
      ],
    };
    const original = documentWith(
      draftSession({
        pairs: [
          {
            id: 'pair-1',
            members: [
              { playerId: 'p1', playerName: 'Erik' },
              { playerId: 'p2', playerName: 'André' },
            ],
          },
          keep,
        ],
      })
    );

    const result = removeSessionPair(original, 'session-1', 'pair-1', roster, { now: NOW });

    expect(result.ok).toBe(true);
    expect(result.session.pairs).toEqual([keep]);
    expect(result.session.createdAt).toBe(ISO_CREATED);
    expect(result.session.updatedAt).toBe(ISO_UPDATED);
    expect(validateSessionPairs(result.session.pairs, roster).ok).toBe(true);
    expect(original.sessions[0].pairs).toHaveLength(2);
  });

  it('rejeita remover dupla inexistente', () => {
    const original = documentWith(draftSession());
    const result = removeSessionPair(original, 'session-1', 'missing', roster, { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('PAIR_NOT_FOUND');
    expect(original.sessions[0].pairs).toEqual([]);
  });
});

describe('disponibilidade de jogadores', () => {
  it('exclui jogadores já pareados, salvo a dupla em edição', () => {
    const pairs = [
      {
        id: 'pair-1',
        members: [
          { playerId: 'p1', playerName: 'Erik' },
          { playerId: 'p2', playerName: 'André' },
        ],
      },
    ];

    expect([...takenPlayerIds(pairs)]).toEqual(['p1', 'p2']);
    expect(availableRosterPlayers(roster, pairs).map((player) => player.id)).toEqual(['p3', 'p4']);
    expect(availableRosterPlayers(roster, pairs, 'pair-1').map((player) => player.id)).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
    ]);
    expect(canEditSessionPairs(draftSession())).toBe(true);
    expect(canEditSessionPairs(draftSession({ status: 'finished' }))).toBe(false);
    expect(
      pairMemberIdsInRoster(
        [
          {
            id: 'pair-1',
            members: [
              { playerId: 'p1', playerName: 'Erik' },
              { playerId: 'gone', playerName: 'Saiu' },
            ],
          },
        ],
        roster
      )
    ).toEqual(['p1']);
  });
});

describe('replaceSessionPairs', () => {
  const existingPairs = [
    {
      id: 'pair-old',
      members: [
        { playerId: 'p1', playerName: 'Erik antigo' },
        { playerId: 'p2', playerName: 'André antigo' },
      ],
    },
  ];

  const nextPairs = [
    {
      id: 'pair-new-1',
      members: [
        { playerId: 'p1', playerName: 'Erik' },
        { playerId: 'p3', playerName: 'Gabi' },
      ],
    },
    {
      id: 'pair-new-2',
      members: [
        { playerId: 'p2', playerName: 'André' },
        { playerId: 'p4', playerName: 'Luiza' },
      ],
    },
  ];

  it('substitui o conjunto completo de duplas preservando os outros campos', () => {
    const other = draftSession({ id: 'session-2', name: 'Outro' });
    const original = documentWith(
      draftSession({
        pairs: existingPairs,
        name: 'Arena',
      }),
      [other]
    );
    const originalPairs = original.sessions[0].pairs;

    const result = replaceSessionPairs(original, 'session-1', nextPairs, roster, {
      now: NOW,
      replaceConfirmed: true,
    });

    expect(result.ok).toBe(true);
    expect(result.session.id).toBe('session-1');
    expect(result.session.date).toBe('2026-09-12');
    expect(result.session.name).toBe('Arena');
    expect(result.session.status).toBe('draft');
    expect(result.session.createdAt).toBe(ISO_CREATED);
    expect(result.session.updatedAt).toBe(ISO_UPDATED);
    expect(result.session.rounds).toEqual([]);
    expect(result.session.pairs).toEqual(nextPairs);
    expect(result.document.schemaVersion).toBe(1);
    expect(result.document.sessions[1]).toEqual(other);
    expect(original.sessions[0].pairs).toBe(originalPairs);
    expect(original.sessions[0].updatedAt).toBe(ISO_CREATED);
    expect(validateSessionPairs(result.session.pairs, roster).ok).toBe(true);
  });

  it('aplica sem confirmação quando ainda não há duplas', () => {
    const original = documentWith(draftSession());
    const result = replaceSessionPairs(original, 'session-1', nextPairs, roster, { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.session.pairs).toHaveLength(2);
    expect(original.sessions[0].pairs).toEqual([]);
  });

  it('cancela sem alteração quando a confirmação é exigida', () => {
    const original = documentWith(draftSession({ pairs: existingPairs }));
    const result = replaceSessionPairs(original, 'session-1', nextPairs, roster, {
      now: NOW,
      replaceConfirmed: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('REPLACE_CONFIRMATION_REQUIRED');
    expect(result.errors[0].message).toBe(
      'Este sorteio substituirá todas as duplas atuais. Deseja continuar?'
    );
    expect(result.document).toBeNull();
    expect(original.sessions[0].pairs).toEqual(existingPairs);
    expect(original.sessions[0].updatedAt).toBe(ISO_CREATED);
  });

  it('impede aplicação fora de draft', () => {
    const original = documentWith(draftSession({ status: 'in_progress', pairs: existingPairs }));
    const result = replaceSessionPairs(original, 'session-1', nextPairs, roster, {
      now: NOW,
      replaceConfirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('PAIRS_LOCKED');
    expect(original.sessions[0].pairs).toEqual(existingPairs);
  });

  it('impede aplicação com rodadas existentes', () => {
    const original = documentWith(
      draftSession({
        pairs: existingPairs,
        rounds: [{ id: 'round-1', number: 1, matches: [] }],
      })
    );
    const result = replaceSessionPairs(original, 'session-1', nextPairs, roster, {
      now: NOW,
      replaceConfirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('PAIRS_LOCKED');
    expect(original.sessions[0].pairs).toEqual(existingPairs);
    expect(original.sessions[0].rounds).toHaveLength(1);
  });

  it('rejeita encontro inexistente', () => {
    const original = documentWith(draftSession());
    const result = replaceSessionPairs(original, 'missing', nextPairs, roster, { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('SESSION_NOT_FOUND');
  });

  it('rejeita duplas com elenco inválido', () => {
    const original = documentWith(draftSession());
    const result = replaceSessionPairs(
      original,
      'session-1',
      [
        {
          id: 'pair-1',
          members: [
            { playerId: 'missing', playerName: 'Fantasma' },
            { playerId: 'p1', playerName: 'Erik' },
          ],
        },
      ],
      roster,
      { now: NOW }
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('PAIR_PLAYER_NOT_FOUND');
    expect(original.sessions[0].pairs).toEqual([]);
    expect(original.sessions[0].updatedAt).toBe(ISO_CREATED);
  });
});
