import {
  cloneCompetitionSource,
  emptyMatch,
  isByeSlot,
  nextPowerOfTwo,
  resolveIdGenerator,
  roundNameForSlotCount,
  seedBracketOrder,
} from './competitionPrimitives.js';

function seedSlot(seed, seedCount) {
  if (!Number.isInteger(seed) || seed < 1 || seed > seedCount) return { type: 'bye' };
  return { type: 'seed', seed };
}

function generateWinnersRounds(seedCount, { idGenerator }) {
  const createId = resolveIdGenerator(idGenerator);
  const size = nextPowerOfTwo(seedCount);
  const order = seedBracketOrder(size);
  let currentSlots = order.map((seed) => seedSlot(seed, seedCount));
  const rounds = [];
  let roundNumber = 1;

  while (currentSlots.length >= 2) {
    const roundId = createId();
    const matches = [];
    const nextSlots = [];

    for (let index = 0; index < currentSlots.length; index += 2) {
      const slotA = currentSlots[index];
      const slotB = currentSlots[index + 1];

      if (isByeSlot(slotA) && isByeSlot(slotB)) {
        nextSlots.push({ type: 'bye' });
        continue;
      }
      if (isByeSlot(slotA)) {
        nextSlots.push(cloneCompetitionSource(slotB));
        continue;
      }
      if (isByeSlot(slotB)) {
        nextSlots.push(cloneCompetitionSource(slotA));
        continue;
      }

      const match = emptyMatch(createId(), roundId, slotA, slotB);
      matches.push(match);
      nextSlots.push({ type: 'winner', matchId: match.id });
    }

    if (matches.length > 0) {
      rounds.push({
        id: roundId,
        number: roundNumber,
        name: roundNameForSlotCount(currentSlots.length),
        bracket: 'winners',
        matches,
        byes: [],
      });
      roundNumber += 1;
    }

    currentSlots = nextSlots;
  }

  return rounds;
}

function pairSlots(slots, roundId, createId, name, number) {
  const matches = [];
  const winners = [];
  for (let index = 0; index < slots.length; index += 2) {
    const sourceA = slots[index];
    const sourceB = slots[index + 1];
    if (!sourceA || !sourceB) continue;
    const match = emptyMatch(createId(), roundId, sourceA, sourceB);
    matches.push(match);
    winners.push({ type: 'winner', matchId: match.id });
  }
  if (matches.length === 0) return { round: null, winners: slots };
  return {
    round: {
      id: roundId,
      number,
      name,
      bracket: 'losers',
      matches,
      byes: [],
    },
    winners,
  };
}

function loserSlotsOf(round) {
  return (round?.matches ?? []).map((match) => ({ type: 'loser', matchId: match.id }));
}

/**
 * Losers Bracket genérico:
 * começa com os perdedores da primeira rodada do Winners.
 * Enquanto houver drops do Winners:
 * - se houver mais sobreviventes no Losers do que drops, eles jogam entre si (rodada minor);
 * - senão, enfrentam os novos perdedores do Winners em ordem invertida (rodada major).
 * Isso vale para 4, 8, 16 e para chaves com BYE (menos partidas na primeira rodada).
 */
function generateLosersRounds(winnersRounds, { idGenerator }) {
  if (winnersRounds.length < 2) return [];
  const createId = resolveIdGenerator(idGenerator);
  const rounds = [];
  let slots = loserSlotsOf(winnersRounds[0]);
  let dropIndex = 1;
  let roundNumber = 1;

  while (dropIndex < winnersRounds.length) {
    const drop = loserSlotsOf(winnersRounds[dropIndex]);
    if (slots.length === 0) {
      slots = drop;
      dropIndex += 1;
      continue;
    }
    if (slots.length > drop.length) {
      const built = pairSlots(slots, createId(), createId, `Losers ${roundNumber}`, roundNumber);
      if (built.round) {
        rounds.push(built.round);
        roundNumber += 1;
      }
      slots = built.winners;
      continue;
    }
    const incoming = [...drop].reverse();
    const paired = [];
    for (let index = 0; index < slots.length; index += 1) {
      paired.push(slots[index], incoming[index]);
    }
    const built = pairSlots(paired, createId(), createId, `Losers ${roundNumber}`, roundNumber);
    if (built.round) {
      rounds.push(built.round);
      roundNumber += 1;
    }
    slots = built.winners;
    dropIndex += 1;
  }

  return rounds;
}

export function generateDoubleEliminationRounds(
  seedTeamIds,
  { grandFinalMode = 'bracket_reset', idGenerator } = {}
) {
  const createId = resolveIdGenerator(idGenerator);
  const seedCount = (seedTeamIds ?? []).length;
  const winners = generateWinnersRounds(seedCount, { idGenerator: createId });
  const losers = generateLosersRounds(winners, { idGenerator: createId });
  const rounds = [...winners, ...losers];

  const wbFinal = winners.at(-1)?.matches?.[0] ?? null;
  const lbFinal = losers.at(-1)?.matches?.[0] ?? null;
  if (wbFinal && lbFinal) {
    const gfRoundId = createId();
    const gfMatch = emptyMatch(createId(), gfRoundId, {
      type: 'winner',
      matchId: wbFinal.id,
    }, {
      type: 'winner',
      matchId: lbFinal.id,
    });
    rounds.push({
      id: gfRoundId,
      number: 1,
      name: 'Grand Final',
      bracket: 'grand_final',
      matches: [gfMatch],
      byes: [],
    });
    if (grandFinalMode === 'bracket_reset') {
      const resetRoundId = createId();
      rounds.push({
        id: resetRoundId,
        number: 1,
        name: 'Grand Final Reset',
        bracket: 'grand_final_reset',
        matches: [
          emptyMatch(
            createId(),
            resetRoundId,
            { type: 'winner', matchId: gfMatch.id },
            { type: 'loser', matchId: gfMatch.id }
          ),
        ],
        byes: [],
      });
    }
  }

  return rounds;
}

export function generateSingleEliminationStageRounds(seedTeamIds, { idGenerator } = {}) {
  return generateWinnersRounds((seedTeamIds ?? []).length, { idGenerator }).map((round) => ({
    ...round,
    bracket: 'winners',
  }));
}
