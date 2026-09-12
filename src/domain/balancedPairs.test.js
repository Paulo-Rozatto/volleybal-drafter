import { describe, expect, it } from 'vitest';
import { generateBalancedPairs } from './balancedPairs.js';
import { validateSessionPairs } from './sessionValidation.js';

const fourPlayers = [
  { id: 'p1', name: 'Erik', score: 4, gender: 'M', height: 'tall' },
  { id: 'p2', name: 'André', score: 3, gender: 'M', height: 'tall' },
  { id: 'p3', name: 'Gabi', score: 4, gender: 'F', height: 'short' },
  { id: 'p4', name: 'Luiza', score: 3, gender: 'F', height: 'short' },
];

const sixPlayers = [
  ...fourPlayers,
  { id: 'p5', name: 'Ana', score: 2, gender: 'F', height: 'short' },
  { id: 'p6', name: 'Paulo', score: 5, gender: 'M', height: 'tall' },
];

function sequentialIds(prefix = 'pair') {
  let count = 0;
  return () => `${prefix}-${(count += 1)}`;
}

function memberIds(pairs) {
  return pairs.flatMap((pair) => pair.members.map((member) => member.playerId)).sort();
}

describe('generateBalancedPairs', () => {
  it('gera duas duplas a partir de quatro jogadores', () => {
    const result = generateBalancedPairs(fourPlayers, {
      idGenerator: sequentialIds(),
      random: () => 0,
      iterations: 8,
    });

    expect(result.ok).toBe(true);
    expect(result.pairs).toHaveLength(2);
    expect(result.pairs.map((pair) => pair.id)).toEqual(['pair-1', 'pair-2']);
    expect(validateSessionPairs(result.pairs, fourPlayers).ok).toBe(true);
  });

  it('gera três duplas a partir de seis jogadores', () => {
    const result = generateBalancedPairs(sixPlayers, {
      idGenerator: sequentialIds(),
      random: () => 0,
      iterations: 8,
    });

    expect(result.ok).toBe(true);
    expect(result.pairs).toHaveLength(3);
  });

  it('coloca cada jogador exatamente uma vez e não deixa ninguém no banco', () => {
    const result = generateBalancedPairs(sixPlayers, {
      idGenerator: sequentialIds(),
      random: () => 0,
      iterations: 5,
    });

    expect(memberIds(result.pairs)).toEqual(sixPlayers.map((player) => player.id).sort());
    expect(result.pairs.length * 2).toBe(sixPlayers.length);
    expect(result).not.toHaveProperty('bench');
  });

  it('rejeita menos de quatro jogadores', () => {
    const result = generateBalancedPairs(fourPlayers.slice(0, 2), {
      idGenerator: sequentialIds(),
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('TOO_FEW_PLAYERS');
    expect(result.pairs).toBeNull();
  });

  it('rejeita quantidade ímpar', () => {
    const three = generateBalancedPairs(fourPlayers.slice(0, 3), {
      idGenerator: sequentialIds(),
    });
    expect(three.ok).toBe(false);
    expect(three.errors[0].code).toBe('ODD_PLAYER_COUNT');
    expect(three.errors[0].message).toBe(
      'Selecione uma quantidade par de jogadores. Adicione ou remova uma pessoa.'
    );

    const five = generateBalancedPairs([...fourPlayers, sixPlayers[4]], {
      idGenerator: sequentialIds(),
    });
    expect(five.errors[0].code).toBe('ODD_PLAYER_COUNT');
    expect(five.pairs).toBeNull();
  });

  it('rejeita jogador com ID inválido ou duplicado', () => {
    expect(
      generateBalancedPairs(
        [...fourPlayers.slice(0, 3), { id: '   ', name: 'X', score: 1 }],
        { idGenerator: sequentialIds() }
      ).errors[0].code
    ).toBe('PLAYER_ID_INVALID');

    expect(
      generateBalancedPairs(
        [...fourPlayers.slice(0, 3), { id: 'p1', name: 'Clone', score: 1 }],
        { idGenerator: sequentialIds() }
      ).errors[0].code
    ).toBe('PLAYER_ID_DUPLICATE');
  });

  it('gera IDs de dupla únicos', () => {
    const result = generateBalancedPairs(sixPlayers, {
      idGenerator: sequentialIds(),
      random: () => 0,
      iterations: 3,
    });
    const ids = result.pairs.map((pair) => pair.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejeita idGenerator inválido ou duplicado sem resultado parcial', () => {
    expect(
      generateBalancedPairs(fourPlayers, { idGenerator: 'nope', random: () => 0, iterations: 1 }).errors[0]
        .code
    ).toBe('ID_GENERATOR_INVALID');

    const emptyIds = generateBalancedPairs(fourPlayers, {
      idGenerator: () => '',
      random: () => 0,
      iterations: 1,
    });
    expect(emptyIds.ok).toBe(false);
    expect(emptyIds.pairs).toBeNull();

    const duplicateIds = generateBalancedPairs(fourPlayers, {
      idGenerator: () => 'same',
      random: () => 0,
      iterations: 1,
    });
    expect(duplicateIds.ok).toBe(false);
    expect(duplicateIds.pairs).toBeNull();
  });

  it('armazena nomes como snapshot', () => {
    const named = fourPlayers.map((player, index) =>
      index === 0 ? { ...player, name: '  Erik atual  ' } : player
    );
    const result = generateBalancedPairs(named, {
      idGenerator: sequentialIds(),
      random: () => 0,
      iterations: 1,
    });
    const names = result.pairs.flatMap((pair) => pair.members.map((member) => member.playerName));
    expect(names).toContain('Erik atual');
    expect(result.pairs[0].members[0]).toEqual({
      playerId: expect.any(String),
      playerName: expect.any(String),
    });
    expect(result.pairs[0].members[0]).not.toHaveProperty('score');
  });

  it('aceita aleatoriedade e iterações injetáveis', () => {
    let randomCalls = 0;
    const result = generateBalancedPairs(fourPlayers, {
      idGenerator: sequentialIds('inj'),
      random: () => {
        randomCalls += 1;
        return 0;
      },
      iterations: 2,
    });
    expect(result.ok).toBe(true);
    expect(randomCalls).toBeGreaterThan(0);
    expect(result.pairs[0].id).toBe('inj-1');
  });

  it('não muta a entrada', () => {
    const snapshot = JSON.parse(JSON.stringify(fourPlayers));
    generateBalancedPairs(fourPlayers, {
      idGenerator: sequentialIds(),
      random: () => 0,
      iterations: 4,
    });
    expect(fourPlayers).toEqual(snapshot);
  });
});
