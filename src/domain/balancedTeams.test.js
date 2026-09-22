import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calcTeamBalancePenalty } from './teamBalance.js';
import { TEAM_SESSION_SCHEMA_VERSION, validateSessionTeams } from './teamSession.js';
import {
  automaticDrawCountBounds,
  computeTeamSizeDistribution,
  generateBalancedTeams,
} from './balancedTeams.js';
import {
  replaceSessionTeams,
  startTeamSessionRoundRobin,
  updateSessionTeam,
} from '../teamGameSessions.js';

const NOW = () => new Date('2026-09-12T19:00:00.000Z');
const LATER = () => new Date('2026-09-12T20:00:00.000Z');
const ISO_CREATED = '2026-09-12T18:00:00.000Z';

function sequentialIds(prefix = 'team') {
  let count = 0;
  return () => `${prefix}-${(count += 1)}`;
}

function makePlayers(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Jogador ${index + 1}`,
    score: (index % 5) + 1,
    gender: index % 2 === 0 ? 'F' : 'M',
    height: index % 3 === 0 ? 'tall' : 'short',
  }));
}

function memberIds(teams) {
  return (teams ?? []).flatMap((team) => (team.members ?? []).map((member) => member.playerId)).sort();
}

function teamSizes(teams) {
  return (teams ?? []).map((team) => team.members.length);
}

function groupsFromResult(result, players) {
  const byId = new Map(players.map((player) => [player.id, player]));
  return result.teams.map((team) => team.members.map((member) => byId.get(member.playerId)));
}

function draftDocument(format, teams = []) {
  return {
    schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
    sessions: [
      {
        id: 'session-1',
        date: '2026-09-12',
        name: '16/3/6',
        status: 'draft',
        createdAt: ISO_CREATED,
        updatedAt: ISO_CREATED,
        format,
        teams,
        rounds: [],
      },
    ],
  };
}

function allMatches(rounds) {
  return (rounds ?? []).flatMap((round) => round.matches ?? []);
}

describe('computeTeamSizeDistribution', () => {
  it('calcula 6/5/5, 5/5/5, 5/4/4, 4/3/3 e 2x2 completo', () => {
    expect(computeTeamSizeDistribution(16, { teamSize: 6, teamCount: 3 }).sizes).toEqual([6, 5, 5]);
    expect(computeTeamSizeDistribution(15, { teamSize: 6, teamCount: 3 }).sizes).toEqual([5, 5, 5]);
    expect(computeTeamSizeDistribution(13, { teamSize: 6, teamCount: 3 }).sizes).toEqual([5, 4, 4]);
    expect(computeTeamSizeDistribution(10, { teamSize: 4, teamCount: 3 }).sizes).toEqual([4, 3, 3]);
    expect(computeTeamSizeDistribution(8, { teamSize: 2, teamCount: 4 }).sizes).toEqual([2, 2, 2, 2]);
  });

  it('respeita mínimo, máximo e capacidade', () => {
    expect(computeTeamSizeDistribution(3, { teamSize: 6, teamCount: 3 }).sizes).toEqual([1, 1, 1]);
    expect(computeTeamSizeDistribution(18, { teamSize: 6, teamCount: 3 }).sizes).toEqual([6, 6, 6]);
    expect(computeTeamSizeDistribution(2, { teamSize: 6, teamCount: 3 }).errors[0].code).toBe(
      'TOO_FEW_PLAYERS'
    );
    expect(computeTeamSizeDistribution(19, { teamSize: 6, teamCount: 3 }).errors[0].code).toBe(
      'TOO_MANY_PLAYERS'
    );
    expect(computeTeamSizeDistribution(7, { teamSize: 2, teamCount: 4 }).errors[0].code).toBe(
      'PLAYER_COUNT_INVALID'
    );
  });

  it('não deixa nenhum time ultrapassar teamSize', () => {
    const result = computeTeamSizeDistribution(16, { teamSize: 6, teamCount: 3 });
    expect(Math.max(...result.sizes)).toBeLessThanOrEqual(6);
  });
});

describe('automaticDrawCountBounds', () => {
  it('define limites por formato', () => {
    expect(automaticDrawCountBounds({ teamSize: 2, teamCount: 4 })).toEqual({
      ok: true,
      errors: [],
      min: 8,
      max: 8,
    });
    expect(automaticDrawCountBounds({ teamSize: 6, teamCount: 3 })).toEqual({
      ok: true,
      errors: [],
      min: 3,
      max: 18,
    });
    expect(automaticDrawCountBounds({ teamSize: 1, teamCount: 2 }).ok).toBe(false);
  });
});

describe('generateBalancedTeams', () => {
  it('gera times nos formatos 2–6 sem banco', () => {
    for (const teamSize of [2, 3, 4, 5, 6]) {
      const teamCount = 2;
      const selectedCount = teamSize === 2 ? 4 : teamSize + 1;
      const players = makePlayers(selectedCount);
      const result = generateBalancedTeams(
        players,
        { teamSize, teamCount },
        { idGenerator: sequentialIds(`f${teamSize}`), random: () => 0, iterations: 8 }
      );

      expect(result.ok).toBe(true);
      expect(result.teams).toHaveLength(2);
      expect(result).not.toHaveProperty('bench');
      expect(memberIds(result.teams)).toEqual(players.map((player) => player.id).sort());
      expect(Math.max(...teamSizes(result.teams))).toBeLessThanOrEqual(teamSize);
      expect(validateSessionTeams(result.teams, { teamSize, teamCount }, players).ok).toBe(true);
    }
  });

  it('distribui 16 jogadores em 6x6 com três times 6/5/5', () => {
    const players = makePlayers(16);
    const format = { teamSize: 6, teamCount: 3 };
    const result = generateBalancedTeams(players, format, {
      idGenerator: sequentialIds(),
      random: () => 0,
      iterations: 24,
    });

    expect(result.ok).toBe(true);
    expect(result.selectedCount).toBe(16);
    expect(result.teams).toHaveLength(3);
    expect([...result.teamSizes].sort((left, right) => right - left)).toEqual([6, 5, 5]);
    expect([...teamSizes(result.teams)].sort((left, right) => right - left)).toEqual([6, 5, 5]);
    expect(memberIds(result.teams)).toEqual(players.map((player) => player.id).sort());
    expect(result).not.toHaveProperty('bench');
    expect(result).not.toHaveProperty('lineups');
    expect(result).not.toHaveProperty('rounds');
    expect(Math.max(...teamSizes(result.teams))).toBeLessThanOrEqual(6);
    expect(validateSessionTeams(result.teams, format, players).ok).toBe(true);

    for (const member of result.teams.flatMap((team) => team.members)) {
      expect(Object.keys(member).sort()).toEqual(['playerId', 'playerName']);
      expect(member).not.toHaveProperty('score');
      expect(member).not.toHaveProperty('gender');
      expect(member).not.toHaveProperty('height');
    }
  });

  it('distribui 15, 13 e 10 conforme 5/5/5, 5/4/4 e 4/3/3', () => {
    const fifteen = generateBalancedTeams(makePlayers(15), { teamSize: 6, teamCount: 3 }, {
      idGenerator: sequentialIds('a'),
      random: () => 0,
      iterations: 4,
    });
    expect([...teamSizes(fifteen.teams)].sort((left, right) => right - left)).toEqual([5, 5, 5]);

    const thirteen = generateBalancedTeams(makePlayers(13), { teamSize: 6, teamCount: 3 }, {
      idGenerator: sequentialIds('b'),
      random: () => 0,
      iterations: 4,
    });
    expect([...teamSizes(thirteen.teams)].sort((left, right) => right - left)).toEqual([5, 4, 4]);

    const ten = generateBalancedTeams(makePlayers(10), { teamSize: 4, teamCount: 3 }, {
      idGenerator: sequentialIds('c'),
      random: () => 0,
      iterations: 4,
    });
    expect([...teamSizes(ten.teams)].sort((left, right) => right - left)).toEqual([4, 3, 3]);
  });

  it('no 2x2 só aceita duplas completas', () => {
    const complete = generateBalancedTeams(makePlayers(8), { teamSize: 2, teamCount: 4 }, {
      idGenerator: sequentialIds(),
      random: () => 0,
      iterations: 6,
    });
    expect(complete.ok).toBe(true);
    expect(teamSizes(complete.teams)).toEqual([2, 2, 2, 2]);

    expect(
      generateBalancedTeams(makePlayers(7), { teamSize: 2, teamCount: 4 }, { iterations: 1 }).errors[0]
        .code
    ).toBe('PLAYER_COUNT_INVALID');
    expect(
      generateBalancedTeams(makePlayers(3), { teamSize: 2, teamCount: 2 }, { iterations: 1 }).errors[0]
        .code
    ).toBe('PLAYER_COUNT_INVALID');
    expect(
      generateBalancedTeams(makePlayers(5), { teamSize: 2, teamCount: 2 }, { iterations: 1 }).teams
    ).toBeNull();
  });

  it('no 2x2 prioriza parceria inédita sobre o balanceamento', () => {
    const players = [
      { id: 'p1', name: 'Erik', score: 4, gender: 'M', height: 'tall' },
      { id: 'p2', name: 'André', score: 3, gender: 'M', height: 'tall' },
      { id: 'p3', name: 'Gabi', score: 4, gender: 'F', height: 'short' },
      { id: 'p4', name: 'Luiza', score: 3, gender: 'F', height: 'short' },
    ];
    let state = 7 >>> 0;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const result = generateBalancedTeams(
      players,
      { teamSize: 2, teamCount: 2 },
      {
        idGenerator: sequentialIds(),
        random,
        iterations: 400,
        partnershipRepeats: new Map([['p1|p2', 5]]),
      }
    );

    expect(result.ok).toBe(true);
    expect(memberIds(result.teams)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(
      result.teams.some((team) => {
        const ids = team.members.map((member) => member.playerId);
        return ids.includes('p1') && ids.includes('p2');
      })
    ).toBe(false);
  });

  it('aceita mínimo e máximo e rejeita insuficiente ou excesso', () => {
    const format = { teamSize: 6, teamCount: 3 };
    expect(
      generateBalancedTeams(makePlayers(3), format, {
        idGenerator: sequentialIds('min'),
        random: () => 0,
        iterations: 1,
      }).teamSizes
    ).toEqual([1, 1, 1]);
    expect(
      generateBalancedTeams(makePlayers(18), format, {
        idGenerator: sequentialIds('max'),
        random: () => 0,
        iterations: 1,
      }).teamSizes
    ).toEqual([6, 6, 6]);

    const few = generateBalancedTeams(makePlayers(2), format, { iterations: 1 });
    expect(few.ok).toBe(false);
    expect(few.errors[0].code).toBe('TOO_FEW_PLAYERS');
    expect(few.teams).toBeNull();
    expect(few.penalty).toBeNull();

    const many = generateBalancedTeams(makePlayers(19), format, { iterations: 1 });
    expect(many.errors[0].code).toBe('TOO_MANY_PLAYERS');
    expect(many.teams).toBeNull();
  });

  it('rejeita formato inválido sem resultado parcial', () => {
    const result = generateBalancedTeams(makePlayers(4), { teamSize: 1, teamCount: 2 }, { iterations: 1 });
    expect(result.ok).toBe(false);
    expect(result.teams).toBeNull();
    expect(result.errors[0].code).toBe('TEAM_SIZE_INVALID');
  });

  it('rejeita ID inválido, duplicado, nome inválido e score inválido', () => {
    const format = { teamSize: 3, teamCount: 2 };
    const base = makePlayers(4);

    expect(
      generateBalancedTeams([...base.slice(0, 3), { ...base[3], id: '  ' }], format, { iterations: 1 })
        .errors[0].code
    ).toBe('PLAYER_ID_INVALID');
    expect(
      generateBalancedTeams([...base.slice(0, 3), { ...base[3], id: 'p1' }], format, { iterations: 1 })
        .errors[0].code
    ).toBe('PLAYER_ID_DUPLICATE');
    expect(
      generateBalancedTeams([...base.slice(0, 3), { ...base[3], name: '   ' }], format, { iterations: 1 })
        .errors[0].code
    ).toBe('PLAYER_NAME_INVALID');
    expect(
      generateBalancedTeams([...base.slice(0, 3), { ...base[3], score: undefined }], format, {
        iterations: 1,
      }).errors[0].code
    ).toBe('PLAYER_SCORE_INVALID');
    expect(
      generateBalancedTeams([...base.slice(0, 3), { ...base[3], score: Number.NaN }], format, {
        iterations: 1,
      }).errors[0].code
    ).toBe('PLAYER_SCORE_INVALID');
    expect(
      generateBalancedTeams([...base.slice(0, 3), { ...base[3], score: Infinity }], format, {
        iterations: 1,
      }).errors[0].code
    ).toBe('PLAYER_SCORE_INVALID');
    expect(
      generateBalancedTeams([...base.slice(0, 3), { ...base[3], score: '3' }], format, { iterations: 1 })
        .errors[0].code
    ).toBe('PLAYER_SCORE_INVALID');
  });

  it('rejeita idGenerator, IDs de time, random e iterations inválidos', () => {
    const players = makePlayers(4);
    const format = { teamSize: 3, teamCount: 2 };

    expect(
      generateBalancedTeams(players, format, { idGenerator: 'nope', random: () => 0, iterations: 1 })
        .errors[0].code
    ).toBe('ID_GENERATOR_INVALID');
    expect(
      generateBalancedTeams(players, format, { random: null, iterations: 1 }).errors[0].code
    ).toBe('RANDOM_INVALID');
    expect(generateBalancedTeams(players, format, { iterations: 0 }).errors[0].code).toBe(
      'ITERATIONS_INVALID'
    );
    expect(generateBalancedTeams(players, format, { iterations: 1.5 }).errors[0].code).toBe(
      'ITERATIONS_INVALID'
    );

    const emptyIds = generateBalancedTeams(players, format, {
      idGenerator: () => '',
      random: () => 0,
      iterations: 1,
    });
    expect(emptyIds.ok).toBe(false);
    expect(emptyIds.errors[0].code).toBe('TEAM_ID_INVALID');
    expect(emptyIds.teams).toBeNull();

    const duplicateIds = generateBalancedTeams(players, format, {
      idGenerator: () => 'same',
      random: () => 0,
      iterations: 1,
    });
    expect(duplicateIds.ok).toBe(false);
    expect(duplicateIds.errors[0].code).toBe('TEAM_ID_DUPLICATE');
    expect(duplicateIds.teams).toBeNull();
  });

  it('rejeita retornos inválidos de random sem resultado parcial', () => {
    const players = makePlayers(4);
    const format = { teamSize: 2, teamCount: 2 };
    const invalidValues = [1, -0.1, Number.NaN, Infinity, '0.2'];

    for (const value of invalidValues) {
      const result = generateBalancedTeams(players, format, {
        random: () => value,
        iterations: 8,
        idGenerator: sequentialIds(),
      });
      expect(result.ok).toBe(false);
      expect(result.teams).toBeNull();
      expect(result.errors[0].code).toBe('RANDOM_INVALID');
    }

    let calls = 0;
    const delayed = generateBalancedTeams(players, format, {
      random: () => {
        calls += 1;
        return calls === 2 ? 1 : 0;
      },
      iterations: 8,
      idGenerator: sequentialIds(),
    });
    expect(delayed.ok).toBe(false);
    expect(delayed.teams).toBeNull();
    expect(delayed.errors[0].code).toBe('RANDOM_INVALID');
  });

  it('usa a penalidade compartilhada e respeita gênero/altura ligados ou desligados', () => {
    const players = makePlayers(6);
    const format = { teamSize: 3, teamCount: 2 };
    const options = { idGenerator: sequentialIds(), random: () => 0, iterations: 1 };

    const both = generateBalancedTeams(players, format, {
      ...options,
      balanceGender: true,
      balanceHeight: true,
    });
    const genderOff = generateBalancedTeams(players, format, {
      ...options,
      idGenerator: sequentialIds('g'),
      balanceGender: false,
      balanceHeight: true,
    });
    const heightOff = generateBalancedTeams(players, format, {
      ...options,
      idGenerator: sequentialIds('h'),
      balanceGender: true,
      balanceHeight: false,
    });

    expect(both.penalty).toBe(
      calcTeamBalancePenalty(groupsFromResult(both, players), {
        balanceGender: true,
        balanceHeight: true,
      })
    );
    expect(genderOff.penalty).toBe(
      calcTeamBalancePenalty(groupsFromResult(genderOff, players), {
        balanceGender: false,
        balanceHeight: true,
      })
    );
    expect(heightOff.penalty).toBe(
      calcTeamBalancePenalty(groupsFromResult(heightOff, players), {
        balanceGender: true,
        balanceHeight: false,
      })
    );
  });

  it('gera IDs só no resultado escolhido e aceita random/iterações injetáveis', () => {
    const players = makePlayers(16);
    let idCalls = 0;
    let randomCalls = 0;
    const result = generateBalancedTeams(
      players,
      { teamSize: 6, teamCount: 3 },
      {
        idGenerator: () => {
          idCalls += 1;
          return `chosen-${idCalls}`;
        },
        random: () => {
          randomCalls += 1;
          return 0;
        },
        iterations: 5,
      }
    );

    expect(result.ok).toBe(true);
    expect(idCalls).toBe(3);
    expect(randomCalls).toBeGreaterThan(0);
    expect(result.teams.map((team) => team.id)).toEqual(['chosen-1', 'chosen-2', 'chosen-3']);
  });

  it('não muta jogadores, formato nem opções', () => {
    const players = makePlayers(10);
    const format = { teamSize: 4, teamCount: 3 };
    const options = {
      idGenerator: sequentialIds(),
      random: () => 0,
      iterations: 6,
      balanceGender: true,
      balanceHeight: false,
    };
    const playerSnapshot = JSON.parse(JSON.stringify(players));
    const formatSnapshot = { ...format };
    const optionsSnapshot = { ...options };

    generateBalancedTeams(players, format, options);

    expect(players).toEqual(playerSnapshot);
    expect(format).toEqual(formatSnapshot);
    expect(options).toEqual(optionsSnapshot);
  });

  it('aplica o resultado por replaceSessionTeams e cancela sem mudar o documento', () => {
    const players = makePlayers(16);
    const format = { teamSize: 6, teamCount: 3 };
    const generated = generateBalancedTeams(players, format, {
      idGenerator: sequentialIds('draw'),
      random: () => 0,
      iterations: 12,
    });
    const existing = [{ id: 'old', members: [{ playerId: 'p1', playerName: 'Jogador 1' }] }];
    const original = draftDocument(format, existing);
    const snapshot = JSON.parse(JSON.stringify(original));

    const cancelled = replaceSessionTeams(original, 'session-1', generated.teams, {
      roster: players,
      now: NOW,
    });
    expect(cancelled.ok).toBe(false);
    expect(cancelled.errors[0].code).toBe('REPLACE_CONFIRMATION_REQUIRED');
    expect(cancelled.errors[0].message).toBe(
      'Este sorteio substituirá todos os times atuais. Deseja continuar?'
    );
    expect(original).toEqual(snapshot);
    expect(original.sessions[0].updatedAt).toBe(ISO_CREATED);
    expect(original.sessions[0].teams).toEqual(existing);
    expect(original.sessions[0].rounds).toEqual([]);

    const applied = replaceSessionTeams(original, 'session-1', generated.teams, {
      roster: players,
      now: NOW,
      replaceConfirmed: true,
    });
    expect(applied.ok).toBe(true);
    expect(applied.session.format).toEqual(format);
    expect(applied.session.status).toBe('draft');
    expect(applied.session.rounds).toEqual([]);
    expect(applied.session.updatedAt).toBe('2026-09-12T19:00:00.000Z');
    expect(applied.session.teams).toHaveLength(3);
    expect([...applied.session.teams.map((team) => team.members.length)].sort((left, right) => right - left)).toEqual(
      [6, 5, 5]
    );
    expect(original).toEqual(snapshot);
  });

  it('permite ajuste manual depois do sorteio e gera rodadas com lineups 6/5/5', () => {
    const players = makePlayers(16);
    const format = { teamSize: 6, teamCount: 3 };
    const generated = generateBalancedTeams(players, format, {
      idGenerator: sequentialIds('base'),
      random: () => 0,
      iterations: 8,
    });
    const applied = replaceSessionTeams(draftDocument(format, []), 'session-1', generated.teams, {
      roster: players,
      now: NOW,
    });

    const firstTeam = applied.session.teams[0];
    const edited = updateSessionTeam(
      applied.document,
      'session-1',
      firstTeam.id,
      firstTeam.members.slice(0, -1).map((member) => member.playerId),
      { roster: players, now: LATER }
    );
    expect(edited.ok).toBe(true);
    expect(edited.session.teams[0].members.length).toBe(firstTeam.members.length - 1);
    expect(edited.session.status).toBe('draft');

    const withDraw = replaceSessionTeams(draftDocument(format, []), 'session-1', generated.teams, {
      roster: players,
      now: NOW,
    });
    const started = startTeamSessionRoundRobin(withDraw.document, 'session-1', {
      roster: players,
      idGenerator: sequentialIds('round'),
      now: LATER,
      generateConfirmed: true,
    });

    expect(started.ok).toBe(true);
    expect(started.session.rounds).toHaveLength(3);
    const sizeByTeam = Object.fromEntries(
      withDraw.session.teams.map((team) => [team.id, team.members.length])
    );
    expect(Object.values(sizeByTeam).sort((left, right) => right - left)).toEqual([6, 5, 5]);
    for (const match of allMatches(started.session.rounds)) {
      expect(match.lineupA).toHaveLength(sizeByTeam[match.teamAId]);
      expect(match.lineupB).toHaveLength(sizeByTeam[match.teamBId]);
    }
  });
});

describe('compatibilidade do Sorteio Rápido e do fluxo ativo', () => {
  it('não liga o Sorteio Rápido a generateBalancedTeams', () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const appSource = readFileSync(join(root, '../App.jsx'), 'utf8');
    expect(appSource).toContain('prepareTeamDraftPool');
    expect(appSource).toContain('calcTeamBalancePenalty');
    expect(appSource).toContain('sort(() => Math.random() - 0.5)');
    expect(appSource).not.toContain('generateBalancedTeams');
  });

  it('não importa generateBalancedPairs no fluxo ativo de encontros', () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const builder = readFileSync(join(root, '../AutomaticTeamBuilder.jsx'), 'utf8');
    const detail = readFileSync(join(root, '../CloudSessionDetail.jsx'), 'utf8');
    expect(builder).toContain('generateBalancedTeams');
    expect(builder).not.toContain('generateBalancedPairs');
    expect(detail).not.toContain('generateBalancedPairs');
  });
});
