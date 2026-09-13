import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TEAM_SESSION_SCHEMA_VERSION } from './domain/teamSession.js';
import {
  buildPlayerPerformanceIndex,
  getCohortPartnershipMatrix,
  listCohortPlayers,
  listSessionParticipants,
} from './domain/playerPerformance.js';
import {
  SESSION_DETAIL_DEFAULT_VIEW,
  SESSION_DETAIL_GAMES_VIEW,
  SESSION_DETAIL_PERFORMANCE_VIEW,
  SESSION_DIAGONAL_CELL,
  formatPartnershipCellLabel,
  formatPartnershipTitle,
  formatTogetherCount,
  formatTogetherModalities,
  formatZeroPartnershipMessage,
  matrixMaxMatches,
  nextSessionDetailView,
  normalizePartnershipSelection,
  partnershipSelectionEquals,
  uniquePartnershipCombos,
} from './sessionPerformancePresentation.js';

const ISO = '2026-09-12T18:00:00.000Z';

const roster = [
  { id: 'andre', name: 'André' },
  { id: 'bh', name: 'BH' },
  { id: 'paulo', name: 'Paulo' },
];

function member(playerId, playerName) {
  return { playerId, playerName };
}

describe('apresentação da matriz de parcerias', () => {
  it('gera combinações únicas e trata A/B como B/A', () => {
    const players = [
      { playerId: 'andre', playerName: 'André' },
      { playerId: 'bh', playerName: 'BH' },
      { playerId: 'paulo', playerName: 'Paulo' },
    ];
    const combos = uniquePartnershipCombos(players);
    expect(combos).toHaveLength(3);
    expect(combos.map((item) => `${item.playerId}+${item.partnerId}`)).toEqual([
      'andre+bh',
      'andre+paulo',
      'bh+paulo',
    ]);
    expect(normalizePartnershipSelection('bh', 'andre')).toEqual(
      normalizePartnershipSelection('andre', 'bh')
    );
    expect(partnershipSelectionEquals(normalizePartnershipSelection('andre', 'paulo'), 'paulo', 'andre')).toBe(
      true
    );
    expect(normalizePartnershipSelection('andre', 'andre')).toBeNull();
    expect(nextSessionDetailView(SESSION_DETAIL_DEFAULT_VIEW, SESSION_DETAIL_PERFORMANCE_VIEW)).toBe(
      SESSION_DETAIL_PERFORMANCE_VIEW
    );
    expect(nextSessionDetailView(SESSION_DETAIL_PERFORMANCE_VIEW, 'other')).toBe(
      SESSION_DETAIL_PERFORMANCE_VIEW
    );
  });

  it('rótulos de zero, singular, plural, diagonal e homônimos por ID', () => {
    expect(formatTogetherCount(0)).toBe('0 jogos juntos');
    expect(formatTogetherCount(1)).toBe('1 jogo junto');
    expect(formatTogetherCount(3)).toBe('3 jogos juntos');
    expect(formatPartnershipCellLabel('André', 'BH', 3)).toBe('André e BH: 3 jogos juntos');
    expect(formatPartnershipCellLabel('André', 'BH', 1)).toBe('André e BH: 1 jogo junto');
    expect(formatPartnershipCellLabel('André', 'Paulo', 0)).toBe('André e Paulo: Nenhum jogo junto');
    expect(formatPartnershipCellLabel('André', 'André', null)).toBe(`André: ${SESSION_DIAGONAL_CELL}`);
    expect(formatPartnershipTitle('BH', 'André')).toBe('Histórico de André e BH');
    expect(formatZeroPartnershipMessage('André', 'Paulo')).toBe(
      'André e Paulo ainda não disputaram uma partida juntos no histórico registrado.'
    );
    expect(formatTogetherModalities([])).toContain('Nenhuma modalidade');
    expect(formatTogetherModalities([2, 6])).toBe('2x2, 6x6');
    const twins = uniquePartnershipCombos([
      { playerId: 'andre-1', playerName: 'André' },
      { playerId: 'andre-2', playerName: 'André' },
    ]);
    expect(twins[0]).toMatchObject({ playerId: 'andre-1', partnerId: 'andre-2' });
  });

  it('lista móvel inclui par com zero e a matriz expõe o máximo de jogos', () => {
    const document = {
      schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
      sessions: [
        {
          id: 'session-pair',
          date: '2026-09-12',
          name: 'Parcerias',
          status: 'draft',
          createdAt: ISO,
          updatedAt: ISO,
          format: { teamSize: 2, teamCount: 3 },
          teams: [
            { id: 't1', members: [member('andre', 'André')] },
            { id: 't2', members: [member('bh', 'BH')] },
            { id: 't3', members: [member('paulo', 'Paulo')] },
          ],
          rounds: [],
        },
      ],
    };
    const built = buildPlayerPerformanceIndex(document, roster);
    const cohort = listSessionParticipants(document, roster, 'session-pair');
    const players = listCohortPlayers(built.index, cohort.participantIds);
    const combos = uniquePartnershipCombos(players);
    expect(combos.some((item) => item.playerId === 'andre' && item.partnerId === 'paulo')).toBe(true);
    expect(matrixMaxMatches(getCohortPartnershipMatrix(built.index, cohort.participantIds))).toBe(0);
  });
});

describe('isolamento da análise no encontro', () => {
  it('trocar aba não altera o documento e filtros não marcam pendência', () => {
    const document = {
      schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
      sessions: [
        {
          id: 'session-1',
          date: '2026-09-12',
          name: 'Arena',
          status: 'draft',
          createdAt: ISO,
          updatedAt: ISO,
          format: { teamSize: 2, teamCount: 2 },
          teams: [],
          rounds: [],
        },
      ],
    };
    const snapshot = JSON.parse(JSON.stringify(document));
    expect(nextSessionDetailView(SESSION_DETAIL_GAMES_VIEW, SESSION_DETAIL_PERFORMANCE_VIEW)).toBe(
      SESSION_DETAIL_PERFORMANCE_VIEW
    );
    expect(document).toEqual(snapshot);

    const view = readFileSync(new URL('./SessionPerformanceView.jsx', import.meta.url), 'utf8');
    const presentation = readFileSync(new URL('./sessionPerformancePresentation.js', import.meta.url), 'utf8');
    const detail = readFileSync(new URL('./GameSessionDetail.jsx', import.meta.url), 'utf8');
    const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
    const sessionsView = readFileSync(new URL('./GameSessionsView.jsx', import.meta.url), 'utf8');
    const combined = `${view}\n${presentation}`;

    expect(combined).not.toMatch(/localStorage/);
    expect(combined).not.toMatch(/markPendingGistChanges/);
    expect(combined).not.toMatch(/gistService/);
    expect(combined).not.toMatch(/persistLocalGameSessions/);
    expect(combined).not.toMatch(/applyGameSessionsOperation/);
    expect(view).not.toMatch(/onApplyOperation/);
    expect(detail).toContain('SESSION_GAMES_TAB_LABEL');
    expect(detail).toContain('SESSION_PERFORMANCE_TAB_LABEL');
    expect(detail).toContain('useState(SESSION_DETAIL_DEFAULT_VIEW)');
    expect(detail).toContain('<SessionPerformanceView');
    expect(detail).toContain('document={document}');
    expect(sessionsView).toContain('document={document}');
    expect(app).toContain('<GameSessionsView');
    expect(app).toContain('document={gameSessions}');
    expect(combined).not.toMatch(/neste encontro/);
    expect(readFileSync(new URL('./domain/sessionPerformance.test.js', import.meta.url), 'utf8')).not.toMatch(
      /neste encontro/
    );
  });
});
