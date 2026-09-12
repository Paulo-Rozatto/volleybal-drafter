import { describe, expect, it } from 'vitest';
import { applyPlayersOperation } from './playerOperations.js';
import { createPlayer, deletePlayer, updatePlayer } from '../players.js';

function createMemoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    snapshot() {
      return { ...data };
    },
  };
}

function createHarness(players, storage) {
  let current = players;
  let pending = false;
  return {
    current: () => current,
    pending: () => pending,
    storage,
    apply(operation) {
      return applyPlayersOperation({
        getPlayers: () => current,
        setPlayers: (next) => {
          current = next;
        },
        persistPlayers: (next) => {
          try {
            storage.setItem('volleyPlayers', JSON.stringify(next));
            return { ok: true };
          } catch (error) {
            return { ok: false, error: error.message };
          }
        },
        markPending: () => {
          pending = true;
        },
        operation,
      });
    },
  };
}

describe('applyPlayersOperation', () => {
  it('duas operações rápidas não perdem alterações', () => {
    const storage = createMemoryStorage({ volleyPlayers: '[]' });
    const harness = createHarness([], storage);
    const first = harness.apply((players) =>
      createPlayer(players, { name: 'QA Um', score: 3, gender: 'F', height: 'short' }, {
        idGenerator: () => 'qa-1',
      })
    );
    const second = harness.apply((players) =>
      createPlayer(players, { name: 'QA Dois', score: 4, gender: 'M', height: 'tall' }, {
        idGenerator: () => 'qa-2',
      })
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(harness.current().map((player) => player.id)).toEqual(['qa-1', 'qa-2']);
    expect(harness.pending()).toBe(true);
    expect(JSON.parse(storage.getItem('volleyPlayers')).map((player) => player.name)).toEqual([
      'QA Um',
      'QA Dois',
    ]);
  });

  it('cancelar exclusão não chama a operação confirmada', () => {
    const storage = createMemoryStorage({
      volleyPlayers: JSON.stringify([{ id: 'p1', name: 'Erik', score: 4, gender: 'M', height: 'tall' }]),
    });
    const original = JSON.parse(storage.getItem('volleyPlayers'));
    const harness = createHarness(original, storage);
    const cancelled = harness.apply((players) => deletePlayer(players, 'p1'));
    expect(cancelled.ok).toBe(false);
    expect(harness.current()).toEqual(original);
    expect(harness.pending()).toBe(false);
    expect(storage.getItem('volleyPlayers')).toBe(JSON.stringify(original));
  });

  it('edição sem mudança não marca pendência nem regrava', () => {
    const player = { id: 'p1', name: 'Erik', score: 4, gender: 'M', height: 'tall' };
    const storage = createMemoryStorage({ volleyPlayers: 'stale' });
    const harness = createHarness([player], storage);
    const result = harness.apply((players) =>
      updatePlayer(players, 'p1', { name: 'Erik', score: 4, gender: 'M', height: 'tall' })
    );
    expect(result.unchanged).toBe(true);
    expect(harness.pending()).toBe(false);
    expect(storage.getItem('volleyPlayers')).toBe('stale');
  });

  it('exclusão confirmada não altera um documento de encontros ao lado', () => {
    const player = { id: 'p1', name: 'Erik', score: 4, gender: 'M', height: 'tall' };
    const sessions = '{"schemaVersion":2,"sessions":[{"id":"s1"}]}';
    const storage = createMemoryStorage({
      volleyPlayers: JSON.stringify([player]),
      volleyGameSessions: sessions,
    });
    const harness = createHarness([player], storage);
    const result = harness.apply((players) => deletePlayer(players, 'p1', { deleteConfirmed: true }));
    expect(result.ok).toBe(true);
    expect(harness.current()).toEqual([]);
    expect(storage.getItem('volleyGameSessions')).toBe(sessions);
  });
});
