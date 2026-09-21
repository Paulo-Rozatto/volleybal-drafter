import { describe, expect, it } from 'vitest';
import {
  attachGroupMembers,
  canManageGroup,
  groupRoleLabel,
  mapGroup,
  mapGroupMember,
} from './groupMappers.js';

describe('group mappers', () => {
  it('mapeia grupo vazio sem descrição e papel do usuário', () => {
    const group = mapGroup({
      myUserId: 'u1',
      group: {
        id: 'g1',
        name: 'Vôlei Quinta',
        description: null,
        join_code: 'AB23CD56',
        created_by: 'u1',
        created_at: '2026-09-21T12:00:00Z',
        updated_at: '2026-09-21T12:00:00Z',
      },
      members: [
        { group_id: 'g1', user_id: 'u1', role: 'owner', joined_at: '2026-09-21T12:00:00Z', profiles: { display_name: 'André' } },
      ],
    });

    expect(group).toMatchObject({
      id: 'g1',
      name: 'Vôlei Quinta',
      description: null,
      joinCode: 'AB23CD56',
      myRole: 'owner',
      memberCount: 1,
    });
    expect(group.members[0]).toEqual({
      userId: 'u1',
      displayName: 'André',
      role: 'owner',
      joinedAt: '2026-09-21T12:00:00Z',
    });
  });

  it('não quebra com membros nulos e agrupa listagem', () => {
    expect(mapGroup({ group: { id: 'g1', name: 'X', join_code: 'AB23CD56' }, members: null }).members).toEqual([]);
    const listed = attachGroupMembers(
      [{ id: 'g1', name: 'Turma', join_code: 'AB23CD56' }],
      [
        { group_id: 'g1', user_id: 'u2', role: 'member' },
        { group_id: 'g1', user_id: 'u1', role: 'owner', profiles: { display_name: 'André' } },
      ],
      'u1'
    );
    expect(listed[0].memberCount).toBe(2);
    expect(listed[0].myRole).toBe('owner');
    expect(listed[0].members.map((member) => member.role)).toEqual(['owner', 'member']);
  });

  it('expõe controles só para owner/admin', () => {
    expect(canManageGroup('owner')).toBe(true);
    expect(canManageGroup('admin')).toBe(true);
    expect(canManageGroup('member')).toBe(false);
    expect(groupRoleLabel('member')).toBe('Membro');
    expect(mapGroupMember({ user_id: 'u3', role: 'admin', profiles: { display_name: 'Paulo' } }).displayName).toBe(
      'Paulo'
    );
  });
});
