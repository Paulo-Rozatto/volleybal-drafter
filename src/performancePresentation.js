import { formatPerformanceModality } from './domain/playerPerformance.js';

const NAME_COLLATOR = new Intl.Collator('pt-BR', { sensitivity: 'base' });
const INTEGER_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export const ALL_MODALITIES_LABEL = 'Todas as modalidades';
export const ALL_PARTNERS_LABEL = 'Todos os parceiros';
export const HISTORICAL_PLAYER_LABEL = 'Histórico';
export const BEST_PARTNER_RANKING_NOTE =
  'Classificação por aproveitamento, sem mínimo de jogos.';
export const NO_PARTNERS_IN_SCOPE_MESSAGE =
  'Ainda não há partidas com parceiros neste recorte.';
export const PERFORMANCE_INTRO =
  'Qualquer partida com placar válido entra no cálculo, independentemente do status do encontro.';
export const MODALITY_RULE_NOTE =
  'A modalidade é determinada pela quantidade de jogadores na escalação de cada lado.';
export const INVALID_SCORES_WARNING =
  'Há partidas com placar inválido. Elas não entram nas estatísticas.';

export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

export function playerMatchesSearch(player, query) {
  const needle = normalizeSearchText(query);
  if (needle === '') return true;
  return normalizeSearchText(player?.playerName).includes(needle);
}

export function filterPlayersBySearch(players, query) {
  return (Array.isArray(players) ? players : []).filter((player) =>
    playerMatchesSearch(player, query)
  );
}

export function resolveSelectedPlayerId(players, selectedId) {
  if (!Array.isArray(players) || players.length === 0) return null;
  if (players.some((player) => player.playerId === selectedId)) return selectedId;
  return players[0].playerId;
}

export function formatWinRatePercent(winRate, matches) {
  if (!matches) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(0);
  }

  const ratio = Number(winRate);
  const safeRatio = Number.isFinite(ratio) ? ratio : 0;
  const roundedTenths = Math.round(safeRatio * 1000) / 10;
  const fractionDigits = Number.isInteger(roundedTenths) ? 0 : 1;

  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 1,
  }).format(safeRatio);
}

export function formatRecordLine({ matches, wins, losses, pointDifference } = {}) {
  const gameLabel = matches === 1 ? 'jogo' : 'jogos';
  const winLabel = wins === 1 ? 'vitória' : 'vitórias';
  const lossLabel = losses === 1 ? 'derrota' : 'derrotas';
  return `${matches} ${gameLabel} · ${wins} ${winLabel} · ${losses} ${lossLabel} · saldo ${formatPointDifference(pointDifference)}`;
}

export function formatPointDifference(value) {
  const number = Number(value);
  const safe = Number.isFinite(number) ? number : 0;
  const abs = INTEGER_FORMAT.format(Math.abs(safe));
  if (safe > 0) return `+${abs}`;
  if (safe < 0) return `-${abs}`;
  return INTEGER_FORMAT.format(0);
}

export function formatPerformanceScopeTitle({
  playerName,
  partnerName = null,
  lineupSize = null,
} = {}) {
  const name = typeof playerName === 'string' && playerName.trim() ? playerName.trim() : 'jogador';
  const partner =
    typeof partnerName === 'string' && partnerName.trim() ? partnerName.trim() : null;
  const modality = lineupSize == null ? '' : formatPerformanceModality(lineupSize);

  if (partner && modality) return `Desempenho de ${name} com ${partner} no ${modality}`;
  if (partner) return `Desempenho de ${name} com ${partner}`;
  if (modality) return `Desempenho de ${name} no ${modality}`;
  return `Desempenho de ${name}`;
}

export function modalityFilterOptions(lineupSizes) {
  const sizes = [...new Set(lineupSizes ?? [])]
    .filter((size) => Number.isInteger(size) && size >= 1 && size <= 6)
    .sort((left, right) => left - right);

  return Object.freeze([
    Object.freeze({ value: null, label: ALL_MODALITIES_LABEL }),
    ...sizes.map((size) =>
      Object.freeze({
        value: size,
        label: formatPerformanceModality(size),
      })
    ),
  ]);
}

export function sortPartnersForFilter(partners) {
  return [...(partners ?? [])].sort((left, right) => {
    const byName = NAME_COLLATOR.compare(left.partnerName ?? '', right.partnerName ?? '');
    if (byName !== 0) return byName;
    return String(left.partnerId).localeCompare(String(right.partnerId));
  });
}

export function partnerFilterOptions(partners) {
  return Object.freeze([
    Object.freeze({ value: null, label: ALL_PARTNERS_LABEL }),
    ...sortPartnersForFilter(partners).map((partner) =>
      Object.freeze({
        value: partner.partnerId,
        label: partner.partnerName,
      })
    ),
  ]);
}

export function resolvePartnerFilter(selectedPartnerId, partners) {
  if (selectedPartnerId == null || selectedPartnerId === '') return null;
  if ((partners ?? []).some((partner) => partner.partnerId === selectedPartnerId)) {
    return selectedPartnerId;
  }
  return null;
}

export function keepDomainPartnerOrder(partners) {
  return Object.freeze([...(partners ?? [])]);
}

export function summaryQueryFilters(lineupSize, partnerId) {
  return Object.freeze({
    lineupSize: lineupSize ?? null,
    partnerId: partnerId ?? null,
  });
}

export function rankingQueryFilters(lineupSize) {
  return Object.freeze({
    lineupSize: lineupSize ?? null,
    partnerId: null,
  });
}

export function formatHistoryDiagnostics({
  includedMatches = 0,
  skippedPendingMatches = 0,
  skippedInvalidMatches = 0,
} = {}) {
  return Object.freeze({
    includedLabel: `${includedMatches} ${
      includedMatches === 1 ? 'partida incluída' : 'partidas incluídas'
    }`,
    pendingLabel: `${skippedPendingMatches} ${
      skippedPendingMatches === 1 ? 'partida aguardando placar' : 'partidas aguardando placar'
    }`,
    invalidLabel: `${skippedInvalidMatches} ${
      skippedInvalidMatches === 1
        ? 'partida ignorada por placar inválido'
        : 'partidas ignoradas por placar inválido'
    }`,
    modalityNote: MODALITY_RULE_NOTE,
    invalidWarning: skippedInvalidMatches > 0 ? INVALID_SCORES_WARNING : null,
  });
}

export function modalitySectionTitle({ playerName, partnerName = null } = {}) {
  if (partnerName) return `Desempenho de ${playerName} com ${partnerName} por modalidade`;
  return 'Desempenho por modalidade';
}

export const PERFORMANCE_PLAYER_TAB = 'player';
export const PERFORMANCE_RANKING_TAB = 'ranking';
export const PERFORMANCE_PLAYER_TAB_LABEL = 'Jogador';
export const PERFORMANCE_RANKING_TAB_LABEL = 'Ranking';
export const MATCH_HISTORY_EMPTY_MESSAGE = 'Nenhuma partida neste recorte.';
export const RANKING_INTRO =
  'Compare jogadores com as partidas válidas do histórico. O período usa a data do encontro.';
export const RANKING_PLAYER_FILTER_NOTE =
  'A seleção limita quem aparece no ranking. As estatísticas de cada jogador incluem jogos contra qualquer adversário no período.';

export function formatMatchSideNames(members) {
  return (Array.isArray(members) ? members : [])
    .map((member) => {
      const name = typeof member?.playerName === 'string' ? member.playerName.trim() : '';
      return name === '' ? 'Jogador' : name;
    })
    .join(' / ');
}

export function formatMatchHistoryDate(sessionDate) {
  if (typeof sessionDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    return sessionDate ?? '';
  }
  const [year, month, day] = sessionDate.split('-');
  return `${day}/${month}/${year}`;
}

export function formatMatchHistoryScoreline(entry) {
  const pointsFor = Number.isFinite(Number(entry?.pointsFor)) ? entry.pointsFor : entry?.scoreA;
  const pointsAgainst = Number.isFinite(Number(entry?.pointsAgainst))
    ? entry.pointsAgainst
    : entry?.scoreB;
  return `${formatMatchSideNames(entry?.teammates)} ${pointsFor} × ${pointsAgainst} ${formatMatchSideNames(entry?.opponents)}`;
}

export function formatMatchHistoryResult(result) {
  if (result === 'win') return 'Vitória';
  if (result === 'loss') return 'Derrota';
  return '';
}

export function rankingSortOptions() {
  return Object.freeze([
    Object.freeze({ value: 'name', label: 'Nome' }),
    Object.freeze({ value: 'matches', label: 'Jogos' }),
    Object.freeze({ value: 'wins', label: 'Vitórias' }),
    Object.freeze({ value: 'losses', label: 'Derrotas' }),
    Object.freeze({ value: 'winRate', label: 'Percentual de vitórias' }),
    Object.freeze({ value: 'pointsFor', label: 'Pontos feitos' }),
    Object.freeze({ value: 'pointsAgainst', label: 'Pontos sofridos' }),
    Object.freeze({ value: 'pointDifference', label: 'Saldo' }),
  ]);
}

export function resolveRankingPlayerIds(selectedIds, players) {
  const allowed = new Set((players ?? []).map((player) => player.playerId));
  const selected = (selectedIds ?? []).filter((id) => allowed.has(id));
  return selected.length === 0 ? null : Object.freeze(selected);
}

export function nextPerformanceTab(currentTab, nextTab) {
  if (nextTab === PERFORMANCE_PLAYER_TAB || nextTab === PERFORMANCE_RANKING_TAB) return nextTab;
  return currentTab === PERFORMANCE_RANKING_TAB ? PERFORMANCE_RANKING_TAB : PERFORMANCE_PLAYER_TAB;
}
