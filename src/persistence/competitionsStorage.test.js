import { describe, expect, it } from 'vitest';
import { COMPETITIONS_STORAGE_KEY } from './constants.js';
import {
  createEmptyCompetitionDocument,
  interpretCompetitionsJson,
  serializeCompetitionsDocument,
  validateCompetitionsDocument,
} from './competitionsDocument.js';
import {
  clearCompetitionsDocument,
  loadCompetitionsDocument,
  loadCompetitionsRecord,
  saveCompetitionsDocument,
} from './competitionsStorage.js';
import { appendDraftCompetition } from '../competitions.js';

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

const ISO = '2026-09-18T18:00:00.000Z';

function sampleDocument() {
  return appendDraftCompetition(createEmptyCompetitionDocument(), {
    name: 'Open',
    format: { teamSize: 2 },
  }, {
    idGenerator: () => 'comp-1',
    now: () => new Date(ISO),
  }).document;
}

describe('competitionsDocument', () => {
  it('interpreta vazio como documento sem competições', () => {
    expect(interpretCompetitionsJson('')).toEqual({
      document: createEmptyCompetitionDocument(),
      sourceVersion: null,
      migrated: false,
    });
    expect(validateCompetitionsDocument(createEmptyCompetitionDocument())).toEqual(
      createEmptyCompetitionDocument()
    );
  });

  it('serializa e relê um documento válido', () => {
    const document = sampleDocument();
    const serialized = serializeCompetitionsDocument(document);
    expect(serialized).toContain('"schemaVersion": 2');
    expect(JSON.parse(serialized)).toEqual(document);
    expect(interpretCompetitionsJson(serialized).document).toEqual(document);
  });

  it('rejeita schema não suportado', () => {
    expect(() => interpretCompetitionsJson(JSON.stringify({ schemaVersion: 9, competitions: [] }))).toThrow(
      'Versão de schema de competições não suportada: 9.'
    );
  });
});

describe('competitionsStorage', () => {
  it('usa documento vazio quando a chave não existe', () => {
    const storage = createMemoryStorage();
    expect(loadCompetitionsRecord(storage)).toEqual({
      document: createEmptyCompetitionDocument(),
      sourceVersion: null,
      migrated: false,
    });
    expect(loadCompetitionsDocument(storage)).toEqual(createEmptyCompetitionDocument());
  });

  it('salva e carrega o cache local separado dos encontros', () => {
    const storage = createMemoryStorage({ volleyGameSessions: '{"schemaVersion":2,"sessions":[]}' });
    const document = sampleDocument();
    saveCompetitionsDocument(document, storage);
    expect(storage.getItem(COMPETITIONS_STORAGE_KEY)).toContain('"comp-1"');
    expect(storage.getItem('volleyGameSessions')).toBe('{"schemaVersion":2,"sessions":[]}');
    expect(loadCompetitionsDocument(storage)).toEqual(document);
    clearCompetitionsDocument(storage);
    expect(storage.getItem(COMPETITIONS_STORAGE_KEY)).toBeNull();
  });
});

describe('leitura do cache sem regravar', () => {
  it('não quebra e não apaga cache corrompido', () => {
    const storage = createMemoryStorage({
      [COMPETITIONS_STORAGE_KEY]: '{broken',
      volleyGameSessions: '{"schemaVersion":2,"sessions":[]}',
    });
    expect(() => loadCompetitionsRecord(storage)).toThrow('JSON inválido no documento de competições.');
    expect(storage.getItem(COMPETITIONS_STORAGE_KEY)).toBe('{broken');
    expect(storage.getItem('volleyGameSessions')).toContain('schemaVersion');
  });

  it('persiste um documento válido sem tocar encontros', () => {
    const storage = createMemoryStorage();
    const document = sampleDocument();
    saveCompetitionsDocument(document, storage);
    expect(loadCompetitionsRecord(storage).document).toEqual(document);
    expect(storage.getItem('volleyGameSessions')).toBeNull();
  });
});
