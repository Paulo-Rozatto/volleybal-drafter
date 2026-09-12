export const SCORE_PENALTY_WEIGHT = 4;
export const GENDER_PENALTY_WEIGHT = 3;
export const HEIGHT_PENALTY_WEIGHT = 3;

function variance(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
}

/**
 * Penalidade de desbalanceamento entre times.
 * Pesos iguais aos do Sorteio Rápido: score x4, gênero x3, altura x3.
 *
 * @param {Array<Array<{ score?: number, gender?: string, height?: string }>>} teams
 * @param {{ balanceGender?: boolean, balanceHeight?: boolean }} [options]
 */
export function calcTeamBalancePenalty(teams, { balanceGender = true, balanceHeight = true } = {}) {
  const groups = Array.isArray(teams) ? teams : [];
  const scores = groups.map((team) => (team ?? []).reduce((sum, player) => sum + player.score, 0));
  let penalty = variance(scores) * SCORE_PENALTY_WEIGHT;

  if (balanceGender) {
    const females = groups.map((team) => (team ?? []).filter((player) => player.gender === 'F').length);
    penalty += variance(females) * GENDER_PENALTY_WEIGHT;
  }

  if (balanceHeight) {
    const talls = groups.map((team) => (team ?? []).filter((player) => player.height === 'tall').length);
    penalty += variance(talls) * HEIGHT_PENALTY_WEIGHT;
  }

  return penalty;
}

/**
 * Separa titulares e banco no Sorteio Rápido, sem mutar a lista recebida.
 *
 * @param {Array<{ score?: number }>} players
 * @param {number} teamSize
 */
export function prepareTeamDraftPool(players, teamSize) {
  const source = Array.isArray(players) ? players : [];
  const sortedPool = [...source].sort((left, right) => right.score - left.score);
  const numTeams = Math.floor(source.length / teamSize);
  const take = numTeams * teamSize;
  return {
    numTeams,
    playersToDraft: sortedPool.slice(0, take),
    bench: sortedPool.slice(take),
  };
}
