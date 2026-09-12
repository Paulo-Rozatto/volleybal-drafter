import { describe, expect, it } from 'vitest';
import {
  createPlayer,
  deletePlayer,
  DELETE_PLAYER_CONFIRMATION_MESSAGE,
  updatePlayer,
} from './players.js';
import { TEAM_SESSION_SCHEMA_VERSION, validateV2Document } from './domain/teamSession.js';
import {
  serializeGameSessionsDocument,
  validateWritableGameSessionsDocument,
} from './persistence/gameSessionsDocument.js';
import { availablePlayersForTeams } from './teamGameSessions.js';

const erik = { id: 'p1', name: 'Erik', score: 4, gender: 'M', height: 'tall' };
const andre = { id: 'p2', name: 'André', score: 3, gender: 'M', height: 'short' };

function sessionWithErikSnapshot(status = 'draft') {
  const session = {
    id: 'session-1',
    date: '2026-09-12',
    name: 'QA Snapshot',
    status,
    createdAt: '2026-09-12T18:00:00.000Z',
    updatedAt: '2026-09-12T18:00:00.000Z',
    format: { teamSize: 2, teamCount: 2 },
    teams: [
      {
        id: 'team-1',
        members: [
          { playerId: 'p1', playerName: 'Erik antigo' },
          { playerId: 'p2', playerName: 'André' },
        ],
      },
      {
        id: 'team-2',
        members: [
          { playerId: 'p3', playerName: 'Gabi' },
          { playerId: 'p4', playerName: 'Luiza' },
        ],
      },
    ],
    rounds: [],
  };

  if (status !== 'draft') {
    session.rounds = [
      {
        id: 'r1',
        number: 1,
        byeTeamId: null,
        matches: [
          {
            id: 'm1',
            teamAId: 'team-1',
            teamBId: 'team-2',
            lineupA: [
              { playerId: 'p1', playerName: 'Erik antigo' },
              { playerId: 'p2', playerName: 'André' },
            ],
            lineupB: [
              { playerId: 'p3', playerName: 'Gabi' },
              { playerId: 'p4', playerName: 'Luiza' },
            ],
            scoreA: status === 'finished' ? 21 : null,
            scoreB: status === 'finished' ? 18 : null,
          },
        ],
      },
    ];
  }

  return { schemaVersion: TEAM_SESSION_SCHEMA_VERSION, sessions: [session] };
}

describe('createPlayer', () => {
  it('cria um jogador sem reutilizar IDs existentes', () => {
    const created = createPlayer([erik], { name: 'QA CRUD Jogador', score: 2, gender: 'F', height: 'short' }, {
      idGenerator: () => 'p1',
    });
    expect(created.ok).toBe(false);
    expect(created.errors[0].code).toBe('PLAYER_ID_REUSED');
    expect(created.players).toBeNull();

    const ok = createPlayer([erik], { name: 'QA CRUD Jogador', score: 2, gender: 'F', height: 'short' }, {
      idGenerator: () => 'p3',
    });
    expect(ok.ok).toBe(true);
    expect(ok.player.id).toBe('p3');
    expect(ok.players).toHaveLength(2);
    expect([erik]).toEqual([{ id: 'p1', name: 'Erik', score: 4, gender: 'M', height: 'tall' }]);
  });

  it('rejeita nome vazio', () => {
    const result = createPlayer([], { name: '   ', score: 3, gender: 'F', height: 'short' }, {
      idGenerator: () => 'p9',
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].field).toBe('name');
  });
});

describe('updatePlayer', () => {
  it('preserva o id e não muta a lista original', () => {
    const original = [erik, andre];
    const result = updatePlayer(original, 'p1', { name: 'Erik QA', score: 5 });
    expect(result.ok).toBe(true);
    expect(result.player.id).toBe('p1');
    expect(result.player.name).toBe('Erik QA');
    expect(result.player.score).toBe(5);
    expect(original[0].name).toBe('Erik');
    expect(original[0].score).toBe(4);
  });

  it('não altera nada quando os valores são iguais', () => {
    const original = [erik];
    const result = updatePlayer(original, 'p1', {
      name: 'Erik',
      score: 4,
      gender: 'M',
      height: 'tall',
    });
    expect(result.ok).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.players[0]).toEqual(erik);
  });
});

describe('deletePlayer', () => {
  it('exige confirmação e não devolve documento parcial', () => {
    const original = [erik, andre];
    const pending = deletePlayer(original, 'p1');
    expect(pending.ok).toBe(false);
    expect(pending.errors[0].message).toBe(DELETE_PLAYER_CONFIRMATION_MESSAGE);
    expect(pending.players).toBeNull();
    expect(original).toHaveLength(2);

    const confirmed = deletePlayer(original, 'p1', { deleteConfirmed: true });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.players.map((player) => player.id)).toEqual(['p2']);
    expect(original).toHaveLength(2);
  });

  it('remove do elenco sem participações e sem reutilizar o ID automaticamente', () => {
    const original = [erik];
    const removed = deletePlayer(original, 'p1', { deleteConfirmed: true });
    expect(removed.ok).toBe(true);
    expect(removed.players).toEqual([]);

    const recreated = createPlayer(removed.players, { name: 'Novo', score: 3, gender: 'F', height: 'short' }, {
      idGenerator: () => 'p9',
    });
    expect(recreated.player.id).toBe('p9');
    expect(recreated.player.id).not.toBe('p1');
  });

  it('excluir ou editar jogador não reescreve snapshots e o documento V2 continua válido', () => {
    const finished = sessionWithErikSnapshot('finished');
    const live = sessionWithErikSnapshot('in_progress');
    const snapshot = JSON.parse(JSON.stringify(finished.sessions[0].teams));
    const lineupSnapshot = JSON.parse(JSON.stringify(finished.sessions[0].rounds[0].matches[0].lineupA));

    const renamed = updatePlayer([erik, andre], 'p1', { name: 'Erik QA' });
    expect(renamed.player.name).toBe('Erik QA');
    expect(finished.sessions[0].teams).toEqual(snapshot);
    expect(finished.sessions[0].rounds[0].matches[0].lineupA).toEqual(lineupSnapshot);
    expect(live.sessions[0].teams[0].members[0].playerName).toBe('Erik antigo');

    const withoutErik = deletePlayer([erik, andre], 'p1', { deleteConfirmed: true });
    expect(withoutErik.players.map((player) => player.id)).toEqual(['p2']);
    expect(availablePlayersForTeams(withoutErik.players, finished.sessions[0].teams).map((player) => player.id)).toEqual(
      []
    );
    expect(validateV2Document(finished, withoutErik.players).ok).toBe(true);
    expect(validateV2Document(live, withoutErik.players).ok).toBe(true);
    expect(() => validateWritableGameSessionsDocument(finished)).not.toThrow();
    expect(() => validateWritableGameSessionsDocument(live)).not.toThrow();

    const serialized = serializeGameSessionsDocument(finished);
    expect(JSON.parse(serialized).sessions[0].teams[0].members[0]).toEqual({
      playerId: 'p1',
      playerName: 'Erik antigo',
    });
  });
});
