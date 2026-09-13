import { formatPerformanceModality } from './domain/playerPerformance.js';
import {
  ALL_MODALITIES_LABEL,
  formatHistoryDiagnostics,
  formatPointDifference,
  formatWinRatePercent,
  modalityFilterOptions,
} from './performancePresentation.js';

const NAME_COLLATOR = new Intl.Collator('pt-BR', { sensitivity: 'base' });

export const SESSION_PARTNERSHIP_NOTE =
  'As parcerias consideram somente jogadores que estiveram juntos na mesma escalação.';
export const SESSION_COHORT_NOTE =
  'O encontro define os participantes exibidos. Os números consideram todas as partidas com placar válido registradas no histórico.';
export const SESSION_EMPTY_PLAYERS_MESSAGE = 'Este encontro ainda não tem participantes para analisar.';
export const SESSION_DIAGNOSTICS_TITLE = 'Diagnóstico do histórico completo';
export const SESSION_INDIVIDUAL_TITLE = 'Histórico dos participantes';
export const SESSION_INDIVIDUAL_INTRO =
  'Estatísticas do histórico completo dos jogadores relacionados a este encontro.';
export const SESSION_MATRIX_TITLE = 'Jogos juntos no histórico';
export const SESSION_GAMES_TAB_LABEL = 'Jogos';
export const SESSION_PERFORMANCE_TAB_LABEL = 'Desempenho';
export const SESSION_DETAIL_GAMES_VIEW = 'games';
export const SESSION_DETAIL_PERFORMANCE_VIEW = 'performance';
export const SESSION_DETAIL_DEFAULT_VIEW = SESSION_DETAIL_GAMES_VIEW;
export const SESSION_DIAGONAL_CELL = '—';
export const SESSION_NO_TOGETHER_MODALITIES = 'Nenhuma modalidade em conjunto neste recorte.';

export function uniquePartnershipCombos(players) {
  const list = Array.isArray(players) ? players : [];
  const combos = [];
  for (let left = 0; left < list.length; left += 1) {
    for (let right = left + 1; right < list.length; right += 1) {
      combos.push(
        Object.freeze({
          playerId: list[left].playerId,
          partnerId: list[right].playerId,
          playerName: list[left].playerName,
          partnerName: list[right].playerName,
        })
      );
    }
  }
  return Object.freeze(combos);
}

export function normalizePartnershipSelection(playerId, partnerId) {
  if (typeof playerId !== 'string' || typeof partnerId !== 'string') return null;
  if (playerId === '' || partnerId === '' || playerId === partnerId) return null;
  const [left, right] = [playerId, partnerId].sort((a, b) => a.localeCompare(b));
  return Object.freeze({ left, right });
}

export function partnershipSelectionEquals(selection, playerId, partnerId) {
  const normalized = normalizePartnershipSelection(playerId, partnerId);
  if (!selection || !normalized) return false;
  return selection.left === normalized.left && selection.right === normalized.right;
}

export function formatTogetherCount(matches) {
  const count = Number(matches) || 0;
  if (count === 1) return '1 jogo junto';
  return `${count} jogos juntos`;
}

export function formatPartnershipTogetherPhrase(matches) {
  const count = Number(matches) || 0;
  if (count === 0) return 'Nenhum jogo junto';
  return formatTogetherCount(count);
}

export function formatPartnershipCellLabel(playerName, partnerName, matches) {
  if (matches == null) return `${playerName}: ${SESSION_DIAGONAL_CELL}`;
  return `${playerName} e ${partnerName}: ${formatPartnershipTogetherPhrase(matches)}`;
}

export function nextSessionDetailView(currentView, nextView) {
  if (nextView === SESSION_DETAIL_GAMES_VIEW || nextView === SESSION_DETAIL_PERFORMANCE_VIEW) {
    return nextView;
  }
  return currentView === SESSION_DETAIL_PERFORMANCE_VIEW
    ? SESSION_DETAIL_PERFORMANCE_VIEW
    : SESSION_DETAIL_GAMES_VIEW;
}

export function resolveSessionModalityFilter(selected, lineupSizes) {
  if (selected == null) return null;
  if ((lineupSizes ?? []).includes(selected)) return selected;
  return null;
}

export function formatTogetherModalities(modalities) {
  const sizes = Array.isArray(modalities) ? modalities : [];
  if (sizes.length === 0) return SESSION_NO_TOGETHER_MODALITIES;
  return sizes.map((size) => formatPerformanceModality(size)).join(', ');
}

export function playerNameById(players, playerId) {
  return (players ?? []).find((player) => player.playerId === playerId)?.playerName ?? '';
}

export function formatPartnershipTitle(playerName, partnerName) {
  const names = [String(playerName ?? ''), String(partnerName ?? '')].sort((left, right) =>
    NAME_COLLATOR.compare(left, right)
  );
  return `Histórico de ${names[0]} e ${names[1]}`;
}

export function formatZeroPartnershipMessage(playerName, partnerName) {
  const names = [String(playerName ?? ''), String(partnerName ?? '')].sort((left, right) =>
    NAME_COLLATOR.compare(left, right)
  );
  return `${names[0]} e ${names[1]} ainda não disputaram uma partida juntos no histórico registrado.`;
}

export function partnershipCellHeat(matches, maxMatches) {
  const count = Number(matches) || 0;
  const max = Number(maxMatches) || 0;
  if (count <= 0 || max <= 0) return 0;
  return Math.min(1, count / max);
}

export function matrixMaxMatches(matrix) {
  let max = 0;
  for (const row of matrix?.rows ?? []) {
    for (const cell of row.cells ?? []) {
      if (!cell.diagonal && cell.matches > max) max = cell.matches;
    }
  }
  return max;
}

export function sessionModalityOptions(lineupSizes) {
  return modalityFilterOptions(lineupSizes);
}

export function formatSessionDiagnostics(index) {
  return Object.freeze({
    ...formatHistoryDiagnostics(index),
    partnershipNote: SESSION_PARTNERSHIP_NOTE,
    cohortNote: SESSION_COHORT_NOTE,
  });
}

export { ALL_MODALITIES_LABEL, formatPointDifference, formatWinRatePercent, formatPerformanceModality };
