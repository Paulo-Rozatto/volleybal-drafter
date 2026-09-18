import { describe, expect, it } from 'vitest';
import { COMPETITIONS_STORAGE_KEY, GIST_PENDING_CHANGES_STORAGE_KEY } from './constants.js';
import { createEmptyCompetitionDocument } from './competitionsDocument.js';
import {
  applyCompetitionsOperation,
  INVALID_COMPETITIONS_CACHE_CONFIRMATION_REQUIRED,
} from './competitionOperations.js';
import { persistLocalCompetitions } from './syncHelpers.js';
import { appendDraftCompetition } from '../competitions.js';

const ISO = '2026-09-18T18:00:00.000Z';

function createMemoryStorage(initial = {}) {
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

function createHarness({ document, storage, cacheInvalid = false }) {
  let current = document;
  let pending = false;
  return {
    current: () => current,
    pending: () => pending,
    apply(operation, { discardConfirmed = false } = {}) {
      return applyCompetitionsOperation({
        getDocument: () => current,
        setDocument: (next) => {
          current = next;
        },
        persistDocument: (next) => persistLocalCompetitions(next, storage),
        markPending: () => {
          pending = true;
          storage.setItem(GIST_PENDING_CHANGES_STORAGE_KEY, 'true');
        },
        operation,
        cacheInvalid,
        discardConfirmed,
      });
    },
  };
}

describe('applyCompetitionsOperation', () => {
  it('persiste, atualiza memória e marca pendência do Gist', () => {
    const storage = createMemoryStorage();
    const harness = createHarness({
      document: createEmptyCompetitionDocument(),
      storage,
    });
    const result = harness.apply((document) =>
      appendDraftCompetition(document, { name: 'Open' }, { idGenerator: () => 'c1', now: () => new Date(ISO) })
    );

    expect(result.ok).toBe(true);
    expect(result.persistOk).toBe(true);
    expect(harness.pending()).toBe(true);
    expect(storage.getItem(GIST_PENDING_CHANGES_STORAGE_KEY)).toBe('true');
    expect(storage.getItem(COMPETITIONS_STORAGE_KEY)).toContain('"c1"');
    expect(harness.current().competitions[0].name).toBe('Open');
  });

  it('exige confirmação quando o cache local está inválido', () => {
    const storage = createMemoryStorage();
    const harness = createHarness({
      document: createEmptyCompetitionDocument(),
      storage,
      cacheInvalid: true,
    });
    const blocked = harness.apply((document) =>
      appendDraftCompetition(document, { name: 'Open' }, { idGenerator: () => 'c1', now: () => new Date(ISO) })
    );
    expect(blocked.errors[0].code).toBe(INVALID_COMPETITIONS_CACHE_CONFIRMATION_REQUIRED);
    expect(harness.current().competitions).toEqual([]);

    const confirmed = harness.apply(
      (document) =>
        appendDraftCompetition(document, { name: 'Open' }, { idGenerator: () => 'c1', now: () => new Date(ISO) }),
      { discardConfirmed: true }
    );
    expect(confirmed.ok).toBe(true);
    expect(confirmed.cacheCleared).toBe(true);
  });
});
