import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from './client.js';
import { createGroup, joinGroupByCode, listMyGroups, loadGroup } from './groupApi.js';
import { rpcErrorCode } from './errors.js';
import { createCloudSession } from './sessionApi.js';

function createClient({ tables = {}, rpcs = {} } = {}) {
  return {
    from(table) {
      const state = { table, select: '*', filters: {}, maybeSingle: false };
      const builder = {
        select(spec) {
          state.select = spec;
          return builder;
        },
        eq(column, value) {
          state.filters[column] = value;
          return builder;
        },
        order() {
          return builder;
        },
        maybeSingle() {
          state.maybeSingle = true;
          return builder;
        },
        insert(payload) {
          state.insert = payload;
          return builder;
        },
        single() {
          state.single = true;
          return builder;
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve(run()).then(onFulfilled, onRejected);
        },
      };

      function run() {
        if (state.insert) {
          return { data: { id: 's-new', ...state.insert }, error: null };
        }
        const rows = (tables[state.table] ?? []).filter((row) =>
          Object.entries(state.filters).every(([column, value]) => row[column] === value)
        );
        if (state.maybeSingle || state.single) return { data: rows[0] ?? null, error: null };
        return { data: rows, error: null };
      }

      return builder;
    },
    async rpc(name, params) {
      if (rpcs[name]) return rpcs[name](params);
      return { data: null, error: { message: `missing rpc ${name}` } };
    },
  };
}

describe('groupApi', () => {
  beforeEach(() => {
    getSupabaseClient.mockReset();
  });

  it('distingue erro de código de grupo do código de encontro', () => {
    expect(rpcErrorCode({ message: 'GROUP_JOIN_CODE_NOT_FOUND' })).toBe('GROUP_JOIN_CODE_NOT_FOUND');
    expect(rpcErrorCode({ message: 'JOIN_CODE_NOT_FOUND' })).toBe('JOIN_CODE_NOT_FOUND');
  });

  it('lista grupos vazios sem fingir loading infinito', async () => {
    getSupabaseClient.mockReturnValue(createClient({ tables: { groups: [], group_members: [] } }));
    const result = await listMyGroups('u1');
    expect(result.ok).toBe(true);
    expect(result.groups).toEqual([]);
  });

  it('carrega detalhe com membros e papel atual', async () => {
    getSupabaseClient.mockReturnValue(
      createClient({
        tables: {
          groups: [
            {
              id: 'g1',
              name: 'UFJF',
              description: null,
              join_code: 'AB23CD56',
              created_by: 'u1',
            },
          ],
          group_members: [
            {
              group_id: 'g1',
              user_id: 'u1',
              role: 'owner',
              joined_at: '2026-09-21T12:00:00Z',
              profiles: { display_name: 'André' },
            },
          ],
        },
      })
    );
    const result = await loadGroup('g1', 'u1');
    expect(result.ok).toBe(true);
    expect(result.group.myRole).toBe('owner');
    expect(result.group.members[0].displayName).toBe('André');
  });

  it('propaga erro de API em create/join', async () => {
    getSupabaseClient.mockReturnValue(
      createClient({
        rpcs: {
          create_group: () => ({ data: null, error: { message: 'GROUP_NAME_REQUIRED' } }),
          join_group_by_code: () => ({ data: null, error: { message: 'GROUP_JOIN_CODE_NOT_FOUND' } }),
        },
      })
    );
    const created = await createGroup({ name: '   ' });
    expect(created.ok).toBe(false);
    expect(created.error.code).toBe('GROUP_NAME_REQUIRED');
    const joined = await joinGroupByCode('ZZZZZZZZ');
    expect(joined.ok).toBe(false);
    expect(joined.error.code).toBe('GROUP_JOIN_CODE_NOT_FOUND');
  });

  it('createCloudSession avulso omite grupo e o de grupo envia group_id', async () => {
    let lastInsert;
    getSupabaseClient.mockReturnValue({
      from() {
        return {
          insert(payload) {
            lastInsert = payload;
            return this;
          },
          select() {
            return this;
          },
          single() {
            return Promise.resolve({ data: { id: 's1', ...lastInsert }, error: null });
          },
        };
      },
    });

    const avulso = await createCloudSession({
      date: '2026-09-21',
      name: 'Avulso',
      teamSize: 2,
      teamCount: 2,
      createdBy: 'u1',
    });
    expect(avulso.ok).toBe(true);
    expect(lastInsert.group_id).toBeNull();

    const grouped = await createCloudSession({
      date: '2026-09-21',
      name: 'No grupo',
      teamSize: 2,
      teamCount: 2,
      createdBy: 'u1',
      groupId: 'g1',
    });
    expect(grouped.ok).toBe(true);
    expect(lastInsert.group_id).toBe('g1');
  });
});
