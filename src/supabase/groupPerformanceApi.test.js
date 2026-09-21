import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from './client.js';
import { getGroupPerformanceMatches } from './groupPerformanceApi.js';

describe('groupPerformanceApi', () => {
  beforeEach(() => {
    getSupabaseClient.mockReset();
  });

  it('faz uma única chamada get_group_performance_matches e nunca get_my_performance_matches', async () => {
    const rpcCalls = [];
    getSupabaseClient.mockReturnValue({
      rpc: async (name, params) => {
        rpcCalls.push({ name, params });
        return { data: { group_id: params.p_group_id, members: [], matches: [] }, error: null };
      },
    });

    const first = await getGroupPerformanceMatches('g1');
    const second = await getGroupPerformanceMatches('g1');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(rpcCalls).toEqual([
      { name: 'get_group_performance_matches', params: { p_group_id: 'g1' } },
      { name: 'get_group_performance_matches', params: { p_group_id: 'g1' } },
    ]);
    expect(rpcCalls.every((call) => call.name !== 'get_my_performance_matches')).toBe(true);

    const apiSource = readFileSync(new URL('./groupPerformanceApi.js', import.meta.url), 'utf8');
    const adapterSource = readFileSync(new URL('./groupPerformance.js', import.meta.url), 'utf8');
    const uiSource = readFileSync(new URL('../CloudGroupRanking.jsx', import.meta.url), 'utf8');
    expect(apiSource).not.toContain('get_my_performance_matches');
    expect(adapterSource).not.toContain('get_my_performance_matches');
    expect(uiSource).not.toContain('getMyCloudPerformanceMatches');
    expect(uiSource).not.toContain('get_my_performance_matches');

    const members = Array.from({ length: 100 }, (_, index) => ({
      user_id: `u${index}`,
      display_name: `P${index}`,
      role: 'member',
      player_id: `p${index}`,
      player_name: `P${index}`,
    }));
    getSupabaseClient.mockReturnValue({
      rpc: async (name, params) => {
        rpcCalls.push({ name, params });
        return { data: { group_id: params.p_group_id, members, matches: [] }, error: null };
      },
    });
    const bulk = await getGroupPerformanceMatches('g-100');
    expect(bulk.ok).toBe(true);
    expect(bulk.payload.members).toHaveLength(100);
    expect(rpcCalls.filter((call) => call.name === 'get_group_performance_matches')).toHaveLength(3);
    expect(rpcCalls.filter((call) => call.name === 'get_my_performance_matches')).toHaveLength(0);

    const profileSource = readFileSync(new URL('../CloudProfileView.jsx', import.meta.url), 'utf8');
    expect(profileSource).toContain('getMyCloudPerformanceMatches');
    expect(profileSource).not.toContain('getGroupPerformanceMatches');
  });

  it('propaga erro sem payload', async () => {
    getSupabaseClient.mockReturnValue({
      rpc: async () => ({ data: null, error: { message: 'GROUP_ACCESS_DENIED' } }),
    });
    const result = await getGroupPerformanceMatches('g-other');
    expect(result.ok).toBe(false);
    expect(result.payload).toBeNull();
    expect(result.error.code).toBe('GROUP_ACCESS_DENIED');
  });
});
