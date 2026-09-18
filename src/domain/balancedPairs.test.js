import { describe, expect, it } from 'vitest';
import {
  comparePairingScores,
  generateBalancedPairs,
  scorePairing,
} from './balancedPairs.js';
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

function pairKeys(pairs) {
  return pairs
    .map((pair) =>
      pair.members
        .map((member) => member.playerId)
        .sort()
        .join('+')
    )
    .sort();
}

function together(pairs, leftId, rightId) {
  return pairs.some((pair) => {
    const ids = pair.members.map((member) => member.playerId);
    return ids.includes(leftId) && ids.includes(rightId);
  });
}

function groupsFromIds(players, pairs) {
  const byId = new Map(players.map((player) => [player.id, player]));
  return pairs.map(([left, right]) => [byId.get(left), byId.get(right)]);
}

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
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

  it('rejeita retornos inválidos de random sem resultado parcial', () => {
    const invalidValues = [1, -0.1, Number.NaN, Infinity, '0.2'];

    for (const value of invalidValues) {
      const result = generateBalancedPairs(fourPlayers, {
        random: () => value,
        iterations: 8,
        idGenerator: sequentialIds(),
      });
      expect(result.ok).toBe(false);
      expect(result.pairs).toBeNull();
      expect(result.errors[0].code).toBe('RANDOM_INVALID');
    }

    expect(
      generateBalancedPairs(fourPlayers, { random: null, iterations: 1, idGenerator: sequentialIds() })
        .errors[0].code
    ).toBe('RANDOM_INVALID');
  });
});

describe('variedade de parceiros no sorteio de duplas', () => {
  it('avalia parcerias inéditas acima de parcerias já repetidas, sem peso mágico', () => {
    const history = new Map([['p1|p2', 5]]);
    const repeated = scorePairing(groupsFromIds(fourPlayers, [['p1', 'p2'], ['p3', 'p4']]), {
      partnershipRepeats: history,
    });
    const unused = scorePairing(groupsFromIds(fourPlayers, [['p1', 'p3'], ['p2', 'p4']]), {
      partnershipRepeats: history,
    });

    expect(repeated.maxRepeat).toBe(5);
    expect(unused.maxRepeat).toBe(0);
    expect(comparePairingScores(unused, repeated)).toBeLessThan(0);
    expect(unused.balancePenalty).toBeGreaterThan(0);
  });

  it('com o mesmo máximo e a mesma soma, prefere repetição mais uniforme', () => {
    const even = scorePairing(groupsFromIds(sixPlayers, [['p1', 'p2'], ['p3', 'p4'], ['p5', 'p6']]), {
      partnershipRepeats: new Map([
        ['p1|p2', 2],
        ['p3|p4', 1],
        ['p5|p6', 1],
      ]),
    });
    const clustered = scorePairing(groupsFromIds(sixPlayers, [['p1', 'p2'], ['p3', 'p4'], ['p5', 'p6']]), {
      partnershipRepeats: new Map([
        ['p1|p2', 2],
        ['p3|p4', 2],
        ['p5|p6', 0],
      ]),
    });

    expect(even.maxRepeat).toBe(clustered.maxRepeat);
    expect(even.repeatSum).toBe(clustered.repeatSum);
    expect(even.repeatSpread).toBeLessThan(clustered.repeatSpread);
    expect(comparePairingScores(even, clustered)).toBeLessThan(0);
  });

  it('prefere parceria nunca utilizada a parceria já repetida no Monte Carlo', () => {
    const result = generateBalancedPairs(fourPlayers, {
      idGenerator: sequentialIds(),
      random: createSeededRandom(7),
      iterations: 400,
      partnershipRepeats: new Map([['p1|p2', 5]]),
    });

    expect(result.ok).toBe(true);
    expect(together(result.pairs, 'p1', 'p2')).toBe(false);
    expect(memberIds(result.pairs)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('depois que todos já jogaram juntos, prefere as parcerias menos frequentes', () => {
    const history = new Map([
      ['p1|p2', 3],
      ['p1|p3', 1],
      ['p1|p4', 1],
      ['p2|p3', 1],
      ['p2|p4', 1],
      ['p3|p4', 1],
    ]);
    const frequent = scorePairing(groupsFromIds(fourPlayers, [['p1', 'p2'], ['p3', 'p4']]), {
      partnershipRepeats: history,
    });
    const rare = scorePairing(groupsFromIds(fourPlayers, [['p1', 'p3'], ['p2', 'p4']]), {
      partnershipRepeats: history,
    });
    expect(frequent.maxRepeat).toBe(3);
    expect(rare.maxRepeat).toBe(1);
    expect(comparePairingScores(rare, frequent)).toBeLessThan(0);

    const result = generateBalancedPairs(fourPlayers, {
      idGenerator: sequentialIds(),
      random: createSeededRandom(11),
      iterations: 400,
      partnershipRepeats: history,
    });
    expect(together(result.pairs, 'p1', 'p2')).toBe(false);
  });

  it('empate de histórico é resolvido pelo balanceamento atual', () => {
    const mixed = scorePairing(groupsFromIds(fourPlayers, [['p1', 'p4'], ['p2', 'p3']]));
    const sameGender = scorePairing(groupsFromIds(fourPlayers, [['p1', 'p2'], ['p3', 'p4']]));
    expect(mixed.maxRepeat).toBe(0);
    expect(sameGender.maxRepeat).toBe(0);
    expect(mixed.balancePenalty).toBeLessThan(sameGender.balancePenalty);
    expect(comparePairingScores(mixed, sameGender)).toBeLessThan(0);

    const withoutHistory = generateBalancedPairs(fourPlayers, {
      idGenerator: sequentialIds(),
      random: createSeededRandom(3),
      iterations: 400,
    });
    const withEmptyHistory = generateBalancedPairs(fourPlayers, {
      idGenerator: sequentialIds(),
      random: createSeededRandom(3),
      iterations: 400,
      partnershipRepeats: new Map(),
    });
    expect(pairKeys(withoutHistory.pairs)).toEqual(pairKeys(withEmptyHistory.pairs));
    expect(together(withoutHistory.pairs, 'p1', 'p2')).toBe(false);
  });

  it('coloca cada jogador exatamente uma vez e não duplica', () => {
    const result = generateBalancedPairs(sixPlayers, {
      idGenerator: sequentialIds(),
      random: createSeededRandom(19),
      iterations: 200,
      partnershipRepeats: new Map([['p1|p2', 4], ['p3|p4', 4]]),
    });
    expect(memberIds(result.pairs)).toEqual(sixPlayers.map((player) => player.id).sort());
    expect(new Set(memberIds(result.pairs)).size).toBe(6);
  });

  it('mesmo input e RNG determinístico produzem o mesmo resultado', () => {
    const options = {
      random: null,
      iterations: 120,
      partnershipRepeats: new Map([['p1|p2', 2], ['p5|p6', 2]]),
    };
    const first = generateBalancedPairs(sixPlayers, {
      ...options,
      idGenerator: sequentialIds('a'),
      random: createSeededRandom(42),
    });
    const second = generateBalancedPairs(sixPlayers, {
      ...options,
      idGenerator: sequentialIds('b'),
      random: createSeededRandom(42),
    });
    expect(pairKeys(first.pairs)).toEqual(pairKeys(second.pairs));
  });

  it('sem histórico permanece compatível com o sorteio atual', () => {
    const options = { random: () => 0, iterations: 8, idGenerator: sequentialIds() };
    const current = generateBalancedPairs(fourPlayers, options);
    const omitted = generateBalancedPairs(fourPlayers, {
      ...options,
      idGenerator: sequentialIds(),
      partnershipRepeats: null,
    });
    expect(pairKeys(current.pairs)).toEqual(pairKeys(omitted.pairs));
    expect(pairKeys(current.pairs)).toEqual(['p1+p4', 'p2+p3']);
  });

  it('não muta o histórico recebido nem a lista de jogadores', () => {
    const playersSnapshot = JSON.parse(JSON.stringify(fourPlayers));
    const history = new Map([['p1|p2', 5], ['p3|p4', 1]]);
    const historySnapshot = [...history.entries()];
    generateBalancedPairs(fourPlayers, {
      idGenerator: sequentialIds(),
      random: createSeededRandom(5),
      iterations: 80,
      partnershipRepeats: history,
    });
    expect(fourPlayers).toEqual(playersSnapshot);
    expect([...history.entries()]).toEqual(historySnapshot);
  });
});
