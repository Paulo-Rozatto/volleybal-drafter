import { describe, expect, it } from 'vitest';
import {
  PENDING_GROUP_JOIN_CODE_KEY,
  PENDING_JOIN_CODE_KEY,
  buildAuthRedirectTo,
  cloudGroupJoinPath,
  cloudJoinPath,
  isCanonicalJoinCode,
  normalizeJoinCode,
  parseGroupJoinHash,
  parseGroupJoinSearch,
  parseJoinHash,
  parseJoinSearch,
  rememberPendingGroupJoinCode,
  rememberPendingJoinCode,
  resolveIncomingJoinCode,
  resolveIncomingJoinIntent,
} from './joinCode.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

describe('joinCode', () => {
  it('normaliza para uppercase canônico sem espaços', () => {
    expect(normalizeJoinCode(' ab23cd56 ')).toBe('AB23CD56');
    expect(isCanonicalJoinCode('ab23cd56')).toBe(true);
    expect(isCanonicalJoinCode('ab12cd34')).toBe(false);
    expect(isCanonicalJoinCode('OI0L1234')).toBe(false);
  });

  it('lê o código do hash e da query', () => {
    expect(parseJoinHash('#/join/ab23cd56')).toBe('AB23CD56');
    expect(parseJoinSearch('?join=ab23cd56')).toBe('AB23CD56');
    expect(parseJoinHash('#access_token=abc')).toBeNull();
  });

  it('preserva o join pendente no sessionStorage quando o hash do magic link some', () => {
    const storage = memoryStorage();
    rememberPendingJoinCode('ab23cd56', storage);
    expect(storage.getItem(PENDING_JOIN_CODE_KEY)).toBe('AB23CD56');
    expect(
      resolveIncomingJoinCode({
        hash: '#access_token=secret',
        search: '',
        storage,
      })
    ).toBe('AB23CD56');
    expect(
      resolveIncomingJoinCode({
        hash: '#access_token=secret',
        search: '?join=xy23kmnp',
        storage,
      })
    ).toBe('XY23KMNP');
  });

  it('não mistura código de grupo com código de encontro', () => {
    expect(parseJoinHash('#/group/join/ab23cd56')).toBeNull();
    expect(parseGroupJoinHash('#/join/ab23cd56')).toBeNull();
    expect(parseGroupJoinHash('#/group/join/ab23cd56')).toBe('AB23CD56');
    expect(parseGroupJoinSearch('?groupJoin=ab23cd56')).toBe('AB23CD56');
    expect(parseJoinSearch('?groupJoin=ab23cd56')).toBeNull();
    expect(cloudGroupJoinPath('ab23cd56')).toBe('#/group/join/AB23CD56');

    const storage = memoryStorage();
    rememberPendingJoinCode('ab23cd56', storage);
    rememberPendingGroupJoinCode('xy23kmnp', storage);
    expect(storage.getItem(PENDING_JOIN_CODE_KEY)).toBe('AB23CD56');
    expect(storage.getItem(PENDING_GROUP_JOIN_CODE_KEY)).toBe('XY23KMNP');
    expect(
      resolveIncomingJoinIntent({
        hash: '#/join/ab23cd56',
        search: '',
        storage,
      })
    ).toEqual({ type: 'session', code: 'AB23CD56' });
    expect(
      resolveIncomingJoinIntent({
        hash: '#/group/join/xy23kmnp',
        search: '',
        storage,
      })
    ).toEqual({ type: 'group', code: 'XY23KMNP' });
    expect(
      resolveIncomingJoinIntent({
        hash: '#access_token=secret',
        search: '?groupJoin=xy23kmnp',
        storage,
      }).type
    ).toBe('group');
  });

  it('monta redirectTo com base do GitHub Pages e query join', () => {
    expect(
      buildAuthRedirectTo({
        origin: 'https://paulo-rozatto.github.io',
        base: '/volleybal-drafter/',
        joinCode: 'ab23cd56',
      })
    ).toBe('https://paulo-rozatto.github.io/volleybal-drafter/?join=AB23CD56');
    expect(cloudJoinPath('ab23cd56')).toBe('#/join/AB23CD56');
    expect(
      buildAuthRedirectTo({
        origin: 'https://paulo-rozatto.github.io',
        base: '/volleybal-drafter/',
        groupJoinCode: 'xy23kmnp',
      })
    ).toBe('https://paulo-rozatto.github.io/volleybal-drafter/?groupJoin=XY23KMNP');
  });
});
