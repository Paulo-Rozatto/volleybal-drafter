import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from './client.js';
import { fetchLegacyImportCloudState, importLegacySession } from './legacyImportApi.js';

describe('legacyImportApi', () => {
  beforeEach(() => {
    getSupabaseClient.mockReset();
  });

  it('importLegacySession chama só a RPC de import e não dual-write', async () => {
    const rpcCalls = [];
    getSupabaseClient.mockReturnValue({
      rpc: async (name, params) => {
        rpcCalls.push({ name, params });
        return { data: { status: 'imported', cloud_id: 'c1', legacy_id: 's1', entity_type: 'session' }, error: null };
      },
    });
    const result = await importLegacySession({ legacyId: 's1', document: { id: 's1' }, batchId: 'b1' });
    expect(result.ok).toBe(true);
    expect(rpcCalls).toEqual([
      {
        name: 'import_legacy_session',
        params: { p_legacy_id: 's1', p_document: { id: 's1' }, p_batch_id: 'b1' },
      },
    ]);
  });

  it('fetchLegacyImportCloudState lê mappings, sessões e competições importadas', async () => {
    const result = { data: [], error: null };
    const query = {
      select() {
        return this;
      },
      not() {
        return this;
      },
      then(resolve, reject) {
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    getSupabaseClient.mockReturnValue({
      from() {
        return query;
      },
      rpc: async (name) => {
        if (name === 'list_mappable_cloud_players') return { data: [], error: null };
        return { data: null, error: null };
      },
    });
    const state = await fetchLegacyImportCloudState();
    expect(state.ok).toBe(true);
    expect(state.playerMappings).toEqual([]);
    expect(state.mappablePlayers).toEqual([]);
  });
});
