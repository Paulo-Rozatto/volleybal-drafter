import {
  getHardestOpponents,
  getPlayerMatchHistory,
  getPlayerOpponentPerformance,
  getPlayerPartnerPerformance,
  getPlayerPerformance,
  listPerformanceModalities,
} from '../domain/playerPerformance.js';
import { formatHistoryDiagnostics } from '../performancePresentation.js';

function byWinRateAsc(left, right) {
  if (left.winRate !== right.winRate) return left.winRate - right.winRate;
  if (right.matches !== left.matches) return right.matches - left.matches;
  return String(left.partnerId ?? left.opponentId).localeCompare(
    String(right.partnerId ?? right.opponentId)
  );
}

function byWinRateDesc(left, right) {
  if (right.winRate !== left.winRate) return right.winRate - left.winRate;
  if (right.matches !== left.matches) return right.matches - left.matches;
  return String(left.opponentId).localeCompare(String(right.opponentId));
}

export function buildPlayerSocialStats(index, playerId, { lineupSize = null } = {}) {
  if (!index || !playerId) {
    return {
      summary: null,
      partners: [],
      lowestPartners: [],
      hardestOpponents: [],
      bestAgainst: [],
      history: [],
      modalities: [],
      diagnostics: null,
    };
  }
  const filters = { lineupSize };
  const partners = getPlayerPartnerPerformance(index, playerId, filters);
  const opponents = getPlayerOpponentPerformance(index, playerId, filters);
  return {
    summary: getPlayerPerformance(index, playerId, filters),
    partners: partners.slice(0, 5),
    lowestPartners: [...partners].sort(byWinRateAsc).slice(0, 5),
    hardestOpponents: getHardestOpponents(index, playerId, filters).slice(0, 5),
    bestAgainst: [...opponents].sort(byWinRateDesc).slice(0, 5),
    history: getPlayerMatchHistory(index, playerId, filters),
    modalities: listPerformanceModalities(index),
    diagnostics: formatHistoryDiagnostics(index),
  };
}
