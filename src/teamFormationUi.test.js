import { describe, expect, it } from 'vitest';
import {
  automaticDrawAvailable,
  automaticDrawOverCapacityMessage,
  automaticDrawPlayerBounds,
  canSelectAnotherMember,
  canSubmitManualTeam,
  formatTeamSizeDistribution,
  generateRoundsBlockedReason,
  manualTeamSubmitError,
  needsEmptyTeamConfirmation,
  parseRequiredInteger,
  parseSessionFormatInput,
  plannedTeamSizeLabel,
  requiresExactPair,
  rosterFitsAutomaticDrawCapacity,
  toggleSelectedPlayer,
} from './teamFormationUi.js';
import {
  GENERATE_ROUNDS_EMPTY_TEAM_MESSAGE,
  GENERATE_ROUNDS_MISSING_TEAMS_MESSAGE,
} from './teamPresentation.js';

describe('parseSessionFormatInput', () => {
  it('aceita formatos 2–6 com quantidade de times explícita', () => {
    for (const teamSize of [2, 3, 4, 5, 6]) {
      const parsed = parseSessionFormatInput({ teamSize, teamCount: 4 });
      expect(parsed.ok).toBe(true);
      expect(parsed.format).toEqual({ teamSize, teamCount: 4 });
      expect(parsed.teamSizeError).toBeNull();
      expect(parsed.teamCountError).toBeNull();
    }
  });

  it('rejeita formato inválido e não calcula teamCount pelo elenco', () => {
    const invalidSize = parseSessionFormatInput({ teamSize: 1, teamCount: 2 });
    expect(invalidSize.ok).toBe(false);
    expect(invalidSize.teamSizeError).toMatch(/entre 2 e 6/);

    const invalidCount = parseSessionFormatInput({ teamSize: 2, teamCount: 1 });
    expect(invalidCount.ok).toBe(false);
    expect(invalidCount.teamCountError).toMatch(/maior ou igual a 2/);

    const both = parseSessionFormatInput({ teamSize: 'abc', teamCount: '1.5' });
    expect(both.ok).toBe(false);
    expect(both.teamSizeError).toBeTruthy();
    expect(both.teamCountError).toBeTruthy();
    expect(parseRequiredInteger('3')).toBe(3);
    expect(Number.isNaN(parseRequiredInteger('3.2'))).toBe(true);
  });
});

describe('regras da montagem manual', () => {
  const ana = { id: 'p1', name: 'Ana' };
  const andre = { id: 'p2', name: 'André' };
  const luiza = { id: 'p3', name: 'Luiza' };

  it('2x2 exige exatamente dois integrantes e não pede time vazio', () => {
    expect(requiresExactPair(2)).toBe(true);
    expect(canSubmitManualTeam(2, 0)).toBe(false);
    expect(canSubmitManualTeam(2, 1)).toBe(false);
    expect(canSubmitManualTeam(2, 2)).toBe(true);
    expect(needsEmptyTeamConfirmation(2, 0)).toBe(false);
    expect(manualTeamSubmitError(2, 1)).toBe('Selecione dois jogadores para formar a dupla.');
    expect(manualTeamSubmitError(2, 2)).toBeNull();
  });

  it('3x3–6x6 aceitam vazio, incompleto e completo até a capacidade', () => {
    for (const teamSize of [3, 4, 5, 6]) {
      expect(requiresExactPair(teamSize)).toBe(false);
      expect(canSubmitManualTeam(teamSize, 0)).toBe(true);
      expect(canSubmitManualTeam(teamSize, 1)).toBe(true);
      expect(canSubmitManualTeam(teamSize, teamSize)).toBe(true);
      expect(canSubmitManualTeam(teamSize, teamSize + 1)).toBe(false);
      expect(needsEmptyTeamConfirmation(teamSize, 0)).toBe(true);
      expect(needsEmptyTeamConfirmation(teamSize, 1)).toBe(false);
      expect(canSelectAnotherMember(teamSize, teamSize - 1)).toBe(true);
      expect(canSelectAnotherMember(teamSize, teamSize)).toBe(false);
    }
  });

  it('bloqueia excesso de integrantes e não muta a seleção', () => {
    const original = [ana, andre];
    const snapshot = [...original];
    expect(toggleSelectedPlayer(original, luiza, 2)).toEqual(original);
    expect(toggleSelectedPlayer(original, andre, 2)).toEqual([ana]);
    expect(toggleSelectedPlayer([], ana, 6)).toEqual([ana]);
    expect(toggleSelectedPlayer([ana], ana, 6)).toEqual([]);
    expect(original).toEqual(snapshot);
  });
});

describe('bloqueio da geração de rodadas', () => {
  it('pede todos os times ou pelo menos um jogador em cada um', () => {
    expect(
      generateRoundsBlockedReason({
        format: { teamSize: 6, teamCount: 3 },
        teams: [{ id: 't1', members: [{ playerId: 'p1', playerName: 'Ana' }] }],
      })
    ).toBe(GENERATE_ROUNDS_MISSING_TEAMS_MESSAGE);

    expect(
      generateRoundsBlockedReason({
        format: { teamSize: 6, teamCount: 2 },
        teams: [
          { id: 't1', members: [{ playerId: 'p1', playerName: 'Ana' }] },
          { id: 't2', members: [] },
        ],
      })
    ).toBe(GENERATE_ROUNDS_EMPTY_TEAM_MESSAGE);

    expect(
      generateRoundsBlockedReason({
        format: { teamSize: 6, teamCount: 2 },
        teams: [
          { id: 't1', members: [{ playerId: 'p1', playerName: 'Ana' }] },
          { id: 't2', members: [{ playerId: 'p2', playerName: 'André' }] },
        ],
      })
    ).toBeNull();
  });

  it('libera o sorteio automático em todos os formatos 2–6', () => {
    for (const teamSize of [2, 3, 4, 5, 6]) {
      expect(automaticDrawAvailable(teamSize)).toBe(true);
    }
    expect(automaticDrawAvailable(1)).toBe(false);
    expect(automaticDrawPlayerBounds({ teamSize: 2, teamCount: 4 })).toEqual({ min: 8, max: 8 });
    expect(automaticDrawPlayerBounds({ teamSize: 6, teamCount: 3 })).toEqual({ min: 3, max: 18 });
  });
});

describe('distribuição prevista do sorteio automático', () => {
  it('formata os tamanhos-alvo usados pela UI', () => {
    expect(formatTeamSizeDistribution([6, 5, 5])).toBe('6 / 5 / 5');
    expect(plannedTeamSizeLabel(16, { teamSize: 6, teamCount: 3 })).toBe('6 / 5 / 5');
    expect(plannedTeamSizeLabel(15, { teamSize: 6, teamCount: 3 })).toBe('5 / 5 / 5');
    expect(plannedTeamSizeLabel(13, { teamSize: 6, teamCount: 3 })).toBe('5 / 4 / 4');
    expect(plannedTeamSizeLabel(10, { teamSize: 4, teamCount: 3 })).toBe('4 / 3 / 3');
    expect(plannedTeamSizeLabel(8, { teamSize: 2, teamCount: 4 })).toBe('2 / 2 / 2 / 2');
    expect(plannedTeamSizeLabel(2, { teamSize: 6, teamCount: 3 })).toBeNull();
    expect(plannedTeamSizeLabel(19, { teamSize: 6, teamCount: 3 })).toBeNull();
  });

  it('esconde selecionar todos quando o elenco ultrapassa a capacidade', () => {
    const format = { teamSize: 6, teamCount: 3 };
    expect(rosterFitsAutomaticDrawCapacity(16, format)).toBe(true);
    expect(rosterFitsAutomaticDrawCapacity(18, format)).toBe(true);
    expect(rosterFitsAutomaticDrawCapacity(19, format)).toBe(false);
    expect(automaticDrawOverCapacityMessage(18)).toBe(
      'Este formato comporta até 18 jogadores. Escolha quem participará.'
    );
  });
});
