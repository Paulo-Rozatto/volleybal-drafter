import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TEAM_SESSION_SCHEMA_VERSION } from './domain/teamSession.js';
import {
  buildPlayerPerformanceIndex,
  formatPerformanceModality,
  getBestPartner,
  getPlayerPartnerPerformance,
  getPlayerPerformance,
  listPerformancePlayers,
} from './domain/playerPerformance.js';
import {
  ALL_MODALITIES_LABEL,
  ALL_PARTNERS_LABEL,
  filterPlayersBySearch,
  formatHistoryDiagnostics,
  formatPerformanceScopeTitle,
  formatPointDifference,
  formatPointsAverage,
  formatRecordLine,
  formatWinRatePercent,
  keepDomainOpponentOrder,
  keepDomainPartnerOrder,
  modalityFilterOptions,
  modalitySectionTitle,
  normalizeSearchText,
  partnerFilterOptions,
  rankingQueryFilters,
  rankingSortOptions,
  resolvePartnerFilter,
  resolveRankingPlayerIds,
  resolveSelectedPlayerId,
  sortPartnersForFilter,
  summaryQueryFilters,
  formatMatchHistoryDate,
  formatMatchHistoryPhase,
  formatMatchHistoryResult,
  formatMatchHistoryScoreline,
  formatMatchHistorySource,
  nextPerformanceTab,
  rankingSourceFilterOptions,
} from './performancePresentation.js';

const ISO = '2026-09-12T18:00:00.000Z';

function member(playerId, playerName) {
  return { playerId, playerName };
}

function documentOf(...sessions) {
  return { schemaVersion: TEAM_SESSION_SCHEMA_VERSION, sessions };
}

function doublesDocument() {
  return documentOf({
    id: 'session-2x2',
    date: '2026-09-12',
    name: 'Arena',
    status: 'in_progress',
    createdAt: ISO,
    updatedAt: ISO,
    format: { teamSize: 2, teamCount: 2 },
    teams: [
      { id: 't1', members: [member('andre', 'André'), member('ana', 'Ana')] },
      { id: 't2', members: [member('gabi', 'Gabi'), member('luiza', 'Luiza')] },
    ],
    rounds: [
      {
        id: 'r1',
        number: 1,
        byeTeamId: null,
        matches: [
          {
            id: 'm1',
            teamAId: 't1',
            teamBId: 't2',
            lineupA: [member('andre', 'André'), member('ana', 'Ana')],
            lineupB: [member('gabi', 'Gabi'), member('luiza', 'Luiza')],
            scoreA: 21,
            scoreB: 18,
          },
        ],
      },
    ],
  });
}

function sixAgainstFiveDocument() {
  return documentOf({
    id: 'session-6x6',
    date: '2026-09-12',
    name: 'Sábado',
    status: 'finished',
    createdAt: ISO,
    updatedAt: ISO,
    format: { teamSize: 6, teamCount: 2 },
    teams: [
      {
        id: 't1',
        members: [
          member('andre', 'André'),
          member('bruno', 'Bruno'),
          member('carla', 'Carla'),
          member('diego', 'Diego'),
          member('erika', 'Erika'),
          member('fabio', 'Fábio'),
        ],
      },
      {
        id: 't2',
        members: [
          member('gabi', 'Gabi'),
          member('luiza', 'Luiza'),
          member('geo', 'Geo'),
          member('ana', 'Ana'),
          member('helen', 'Helen'),
        ],
      },
    ],
    rounds: [
      {
        id: 'r1',
        number: 1,
        byeTeamId: null,
        matches: [
          {
            id: 'm1',
            teamAId: 't1',
            teamBId: 't2',
            lineupA: [
              member('andre', 'André'),
              member('bruno', 'Bruno'),
              member('carla', 'Carla'),
              member('diego', 'Diego'),
              member('erika', 'Erika'),
              member('fabio', 'Fábio'),
            ],
            lineupB: [
              member('gabi', 'Gabi'),
              member('luiza', 'Luiza'),
              member('geo', 'Geo'),
              member('ana', 'Ana'),
              member('helen', 'Helen'),
            ],
            scoreA: 25,
            scoreB: 22,
          },
        ],
      },
    ],
  });
}

const roster = [
  { id: 'andre', name: 'André' },
  { id: 'ana', name: 'Ana' },
  { id: 'bruno', name: 'Bruno' },
  { id: 'carla', name: 'Carla' },
  { id: 'diego', name: 'Diego' },
  { id: 'erika', name: 'Erika' },
  { id: 'fabio', name: 'Fábio' },
  { id: 'gabi', name: 'Gabi' },
  { id: 'luiza', name: 'Luiza' },
  { id: 'geo', name: 'Geo' },
  { id: 'helen', name: 'Helen' },
  { id: 'idle', name: 'Ícaro' },
];

describe('busca e seleção', () => {
  it('ignora maiúsculas e acentos na busca', () => {
    expect(normalizeSearchText('André')).toBe('andre');
    const players = [
      { playerId: 'andre', playerName: 'André' },
      { playerId: 'ana', playerName: 'Ana' },
    ];
    expect(filterPlayersBySearch(players, 'andre').map((player) => player.playerId)).toEqual([
      'andre',
    ]);
    expect(filterPlayersBySearch(players, 'ANDRE').map((player) => player.playerId)).toEqual([
      'andre',
    ]);
    expect(filterPlayersBySearch(players, 'xyz')).toEqual([]);
    expect(filterPlayersBySearch(players, '').map((player) => player.playerId)).toEqual([
      'andre',
      'ana',
    ]);
    expect(filterPlayersBySearch(players, '   ').map((player) => player.playerId)).toEqual([
      'andre',
      'ana',
    ]);
  });

  it('preserva a seleção disponível e cai no primeiro alfabético', () => {
    const players = [
      { playerId: 'ana', playerName: 'Ana' },
      { playerId: 'andre', playerName: 'André' },
    ];
    expect(resolveSelectedPlayerId(players, 'andre')).toBe('andre');
    expect(resolveSelectedPlayerId(players, 'ghost')).toBe('ana');
    expect(resolveSelectedPlayerId([], 'andre')).toBeNull();
  });
});

describe('formatação de apresentação', () => {
  it('formata porcentagem sem alterar o valor do domínio', () => {
    expect(formatWinRatePercent(0, 0)).toBe('0,0%');
    expect(formatWinRatePercent(1, 1)).toBe('100%');
    expect(formatWinRatePercent(0.5, 2)).toBe('50%');
    expect(formatWinRatePercent(2 / 3, 3)).toBe('66,7%');
    expect(2 / 3).toBeGreaterThan(0.66);
  });

  it('formata médias de pontos no locale pt-BR com no máximo uma casa', () => {
    expect(formatPointsAverage(19.5)).toBe('19,5');
    expect(formatPointsAverage(16.25)).toBe('16,3');
    expect(formatPointsAverage(18.7)).toBe('18,7');
    expect(formatPointsAverage(15.3)).toBe('15,3');
    expect(formatPointsAverage(21)).toBe('21');
    expect(formatPointsAverage(0)).toBe('0');
    expect(formatPointsAverage(Number.NaN)).toBe('0');
    expect(formatPointsAverage(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('formata saldo positivo, negativo e zero', () => {
    expect(formatPointDifference(3)).toBe('+3');
    expect(formatPointDifference(-4)).toBe('-4');
    expect(formatPointDifference(0)).toBe('0');
    expect(formatRecordLine({ matches: 1, wins: 1, losses: 0, pointDifference: 3 })).toBe(
      '1 jogo · 1 vitória · 0 derrotas · saldo +3'
    );
    expect(formatRecordLine({ matches: 3, wins: 1, losses: 2, pointDifference: 1 })).toBe(
      '3 jogos · 1 vitória · 2 derrotas · saldo +1'
    );
  });

  it('monta títulos sem filtro, por modalidade, por parceiro e combinado', () => {
    expect(formatPerformanceScopeTitle({ playerName: 'André' })).toBe('Desempenho de André');
    expect(formatPerformanceScopeTitle({ playerName: 'André', lineupSize: 5 })).toBe(
      'Desempenho de André no 5x5'
    );
    expect(formatPerformanceScopeTitle({ playerName: 'André', partnerName: 'Ana' })).toBe(
      'Desempenho de André com Ana'
    );
    expect(
      formatPerformanceScopeTitle({ playerName: 'André', partnerName: 'Ana', lineupSize: 5 })
    ).toBe('Desempenho de André com Ana no 5x5');
  });

  it('lista somente modalidades realmente disputadas além de Todas', () => {
    const options = modalityFilterOptions([6, 2, 2, 5]);
    expect(options.map((item) => item.label)).toEqual([
      ALL_MODALITIES_LABEL,
      '2x2',
      '5x5',
      '6x6',
    ]);
    expect(modalityFilterOptions([]).map((item) => item.label)).toEqual([ALL_MODALITIES_LABEL]);
  });
});

describe('filtros de parceiro e ranking', () => {
  it('redefine parceiro indisponível após troca de modalidade', () => {
    const partnersAtTwo = [{ partnerId: 'ana', partnerName: 'Ana' }];
    const partnersAtSix = [
      { partnerId: 'bruno', partnerName: 'Bruno' },
      { partnerId: 'carla', partnerName: 'Carla' },
    ];
    expect(resolvePartnerFilter('ana', partnersAtTwo)).toBe('ana');
    expect(resolvePartnerFilter('ana', partnersAtSix)).toBeNull();
    expect(resolvePartnerFilter(null, partnersAtSix)).toBeNull();
    expect(partnerFilterOptions(partnersAtSix)[0].label).toBe(ALL_PARTNERS_LABEL);
    expect(sortPartnersForFilter(partnersAtSix).map((item) => item.partnerId)).toEqual([
      'bruno',
      'carla',
    ]);
  });

  it('não reordena o ranking recebido do domínio', () => {
    const ranked = [
      { partnerId: 'zulu', partnerName: 'Zulu', winRate: 1, matches: 1 },
      { partnerId: 'ana', partnerName: 'Ana', winRate: 0, matches: 4 },
    ];
    expect(keepDomainPartnerOrder(ranked).map((item) => item.partnerId)).toEqual(['zulu', 'ana']);
    expect(sortPartnersForFilter(ranked).map((item) => item.partnerId)).toEqual(['ana', 'zulu']);
    expect(
      keepDomainOpponentOrder([
        { opponentId: 'paulo', opponentName: 'Paulo' },
        { opponentId: 'lucas', opponentName: 'Lucas' },
      ]).map((item) => item.opponentId)
    ).toEqual(['paulo', 'lucas']);
  });

  it('consulta de melhor parceiro ignora o filtro de parceiro e respeita modalidade', () => {
    expect(rankingQueryFilters(5)).toEqual({ lineupSize: 5, partnerId: null });
    expect(summaryQueryFilters(5, 'ana')).toEqual({ lineupSize: 5, partnerId: 'ana' });

    const index = buildPlayerPerformanceIndex(
      documentOf(doublesDocument().sessions[0], sixAgainstFiveDocument().sessions[0]),
      roster
    ).index;
    const bestAtTwo = getBestPartner(index, 'andre', rankingQueryFilters(2));
    const bestAll = getBestPartner(index, 'andre', rankingQueryFilters(null));
    const summaryWithAna = getPlayerPerformance(index, 'andre', summaryQueryFilters(null, 'ana'));

    expect(bestAtTwo.partnerId).toBe('ana');
    expect(bestAll.partnerId).not.toBeUndefined();
    expect(summaryWithAna.matches).toBe(1);
    expect(getPlayerPartnerPerformance(index, 'andre', rankingQueryFilters(6)).map((item) => item.partnerId)).toEqual(
      ['bruno', 'carla', 'diego', 'erika', 'fabio']
    );
  });
});

describe('integração com o domínio', () => {
  it('lista jogador atual sem partidas e zero no resumo', () => {
    const index = buildPlayerPerformanceIndex(doublesDocument(), roster).index;
    const idle = listPerformancePlayers(index).find((player) => player.playerId === 'idle');
    expect(idle).toMatchObject({
      playerName: 'Ícaro',
      isCurrentRosterPlayer: true,
      matches: 0,
    });
    expect(getPlayerPerformance(index, 'idle')).toMatchObject({
      matches: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      pointDifference: 0,
    });
    expect(formatWinRatePercent(0, 0)).toBe('0,0%');
    expect(formatPointDifference(0)).toBe('0');
  });

  it('classifica 6 contra 5 em modalidades diferentes por lado', () => {
    const index = buildPlayerPerformanceIndex(sixAgainstFiveDocument(), roster).index;
    expect(getPlayerPerformance(index, 'andre').modalities).toEqual([6]);
    expect(getPlayerPerformance(index, 'gabi').modalities).toEqual([5]);
    expect(formatPerformanceModality(6)).toBe('6x6');
    expect(formatPerformanceModality(5)).toBe('5x5');
    expect(modalityFilterOptions(getPlayerPerformance(index, 'andre').modalities).map((item) => item.label)).toEqual(
      [ALL_MODALITIES_LABEL, '6x6']
    );
    expect(modalityFilterOptions(getPlayerPerformance(index, 'gabi').modalities).map((item) => item.label)).toEqual(
      [ALL_MODALITIES_LABEL, '5x5']
    );
  });

  it('separa diagnóstico global das métricas do jogador', () => {
    const pending = doublesDocument();
    pending.sessions[0].rounds[0].matches.push({
      id: 'm2',
      teamAId: 't1',
      teamBId: 't2',
      lineupA: [member('andre', 'André'), member('ana', 'Ana')],
      lineupB: [member('gabi', 'Gabi'), member('luiza', 'Luiza')],
      scoreA: null,
      scoreB: null,
    });
    const built = buildPlayerPerformanceIndex(pending, roster);
    const andre = getPlayerPerformance(built.index, 'andre');
    const diagnostics = formatHistoryDiagnostics(built.index);

    expect(built.index.includedMatches).toBe(1);
    expect(built.index.skippedPendingMatches).toBe(1);
    expect(andre.matches).toBe(1);
    expect(diagnostics.includedLabel).toContain('partida incluída');
    expect(diagnostics.pendingLabel).toContain('aguardando placar');
    expect(diagnostics.invalidWarning).toBeNull();
    expect(modalitySectionTitle({ playerName: 'André' })).toBe('Desempenho por modalidade');
    expect(modalitySectionTitle({ playerName: 'André', partnerName: 'Ana' })).toBe(
      'Desempenho de André com Ana por modalidade'
    );
  });
});

describe('isolamento da tela', () => {
  it('não importa persistência, Gist nem localStorage', () => {
    const view = readFileSync(new URL('./PlayerPerformanceView.jsx', import.meta.url), 'utf8');
    const rankingView = readFileSync(new URL('./PlayerRankingView.jsx', import.meta.url), 'utf8');
    const hub = readFileSync(new URL('./PerformanceHub.jsx', import.meta.url), 'utf8');
    const presentation = readFileSync(new URL('./performancePresentation.js', import.meta.url), 'utf8');
    const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
    const combined = `${view}\n${rankingView}\n${hub}\n${presentation}`;
    expect(combined).not.toMatch(/localStorage/);
    expect(combined).not.toMatch(/markPendingGistChanges/);
    expect(combined).not.toMatch(/gistService/);
    expect(combined).not.toMatch(/persistLocalGameSessions/);
    expect(combined).not.toMatch(/applyGameSessionsOperation/);
    expect(app).toMatch('<CloudProfileView');
    expect(app).not.toMatch('<PerformanceHub');
    expect(app).not.toMatch('document={gameSessions}');
    expect(app).not.toMatch(/PerformanceHub[\s\S]{0,400}onApplyOperation/);
  });
});

describe('histórico de partidas e ranking', () => {
  it('formata data, placar do ponto de vista do jogador e resultado', () => {
    expect(formatMatchHistoryDate('2026-08-31')).toBe('31/08/2026');
    expect(
      formatMatchHistoryScoreline({
        teammates: [{ playerName: 'André' }, { playerName: 'Paulo' }],
        opponents: [{ playerName: 'João' }, { playerName: 'Pedro' }],
        pointsFor: 21,
        pointsAgainst: 17,
        scoreA: 17,
        scoreB: 21,
      })
    ).toBe('André / Paulo 21 × 17 João / Pedro');
    expect(formatMatchHistoryResult('win')).toBe('Vitória');
    expect(formatMatchHistoryResult('loss')).toBe('Derrota');
    expect(
      formatMatchHistorySource({
        sourceType: 'competition',
        sourceName: 'Clash de Sexta',
      })
    ).toBe('Competição · Clash de Sexta');
    expect(
      formatMatchHistorySource({
        sourceType: 'session',
        sourceName: 'Sábado na Arena',
      })
    ).toBe('Encontro · Sábado na Arena');
    expect(
      formatMatchHistoryPhase({
        sourceType: 'competition',
        roundLabel: 'Semifinal',
      })
    ).toBe('Semifinal');
    expect(formatMatchHistoryPhase({ sourceType: 'session', roundLabel: 'Rodada 1' })).toBe('');
    expect(rankingSourceFilterOptions().map((item) => item.label)).toEqual([
      'Todas',
      'Encontros',
      'Competições',
    ]);
  });

  it('expõe opções de ordenação e trata seleção vazia como todos os jogadores', () => {
    expect(rankingSortOptions().map((item) => item.value)).toEqual([
      'name',
      'matches',
      'wins',
      'losses',
      'winRate',
      'pointsFor',
      'averagePointsFor',
      'pointsAgainst',
      'averagePointsAgainst',
      'pointDifference',
    ]);
    expect(rankingSortOptions().map((item) => item.label)).toEqual([
      'Nome',
      'Jogos',
      'Vitórias',
      'Derrotas',
      'Percentual de vitórias',
      'Pontos feitos',
      'Média de pontos feitos',
      'Pontos sofridos',
      'Média de pontos sofridos',
      'Saldo',
    ]);
    const rankingView = readFileSync(new URL('./PlayerRankingView.jsx', import.meta.url), 'utf8');
    expect(rankingView).toContain('Média feitos');
    expect(rankingView).toContain('Média sofridos');
    expect(rankingView).toContain('formatPointsAverage');
    expect(rankingView).toContain('Origem');
    expect(rankingView).toContain('ranking-source');
    expect(rankingView).toContain('Modalidade');
    expect(rankingView).toContain('ranking-modality');
    expect(rankingView).toContain('listPerformanceModalities');
    expect(rankingView).not.toMatch(/toFixed\(/);
    const playerView = readFileSync(new URL('./PlayerPerformanceView.jsx', import.meta.url), 'utf8');
    expect(playerView).toContain('formatMatchHistorySource');
    expect(playerView).toContain('formatMatchHistoryPhase');
    expect(playerView).toContain('Adversários mais difíceis');
    expect(playerView).toContain('getHardestOpponents');
    const players = [{ playerId: 'andre' }, { playerId: 'paulo' }];
    expect(resolveRankingPlayerIds([], players)).toBeNull();
    expect(resolveRankingPlayerIds(['andre', 'missing'], players)).toEqual(['andre']);
    expect(nextPerformanceTab('player', 'ranking')).toBe('ranking');
  });
});
