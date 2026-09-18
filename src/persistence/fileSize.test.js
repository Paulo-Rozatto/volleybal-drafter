import { describe, expect, it } from 'vitest';
import { createEmptyGameSessionsDocument, serializeGameSessionsDocument } from './gameSessionsDocument.js';
import {
  formatFileSize,
  COMPETITIONS_SIZE_WARNING_BYTES,
  GAME_SESSIONS_SIZE_WARNING_BYTES,
  competitionsPatchUtf8Size,
  gameSessionsPatchUtf8Size,
  utf8TextSize,
} from './fileSize.js';
import { createEmptyCompetitionDocument, serializeCompetitionsDocument } from './competitionsDocument.js';
import { appendDraftTeamSession } from '../teamGameSessions.js';

function nestedAccentDocument() {
  return appendDraftTeamSession(createEmptyGameSessionsDocument(), {
    date: '2026-09-12',
    name: 'São João — pelada',
    format: { teamSize: 2, teamCount: 3 },
  }).document;
}

describe('utf8TextSize', () => {
  it('mede bytes UTF-8 de uma string já serializada', () => {
    const serialized = serializeGameSessionsDocument(createEmptyGameSessionsDocument());
    expect(utf8TextSize(serialized)).toBe(new TextEncoder().encode(serialized).byteLength);
  });

  it('rejeita valor que não é string', () => {
    expect(() => utf8TextSize({ schemaVersion: 2, sessions: [] })).toThrow(
      'O conteúdo serializado precisa ser uma string.'
    );
  });
});

describe('gameSessionsPatchUtf8Size', () => {
  it('usa os bytes da string produzida por serializeGameSessionsDocument', () => {
    const document = nestedAccentDocument();
    const serialized = serializeGameSessionsDocument(document);
    expect(gameSessionsPatchUtf8Size(document)).toBe(utf8TextSize(serialized));
    expect(gameSessionsPatchUtf8Size(document)).toBe(
      new TextEncoder().encode(serialized).byteLength
    );
  });

  it('conta caracteres UTF-8 de nomes acentuados', () => {
    const document = nestedAccentDocument();
    const serialized = serializeGameSessionsDocument(document);
    expect(serialized).toContain('São João — pelada');
    expect(utf8TextSize(serialized)).toBeGreaterThan(serialized.length);
    expect(gameSessionsPatchUtf8Size(document)).toBe(utf8TextSize(serialized));
  });

  it('pretty-print aninhado é maior que o JSON compacto', () => {
    const document = nestedAccentDocument();
    const compact = JSON.stringify(document);
    const pretty = serializeGameSessionsDocument(document);
    expect(pretty).not.toBe(compact);
    expect(utf8TextSize(pretty)).toBeGreaterThan(utf8TextSize(compact));
    expect(gameSessionsPatchUtf8Size(document)).toBe(utf8TextSize(pretty));
  });

  it('o limiar de 750 KiB usa o tamanho efetivamente enviado', () => {
    const document = nestedAccentDocument();
    const compactBytes = utf8TextSize(JSON.stringify(document));
    const sentBytes = gameSessionsPatchUtf8Size(document);

    expect(sentBytes).toBe(utf8TextSize(serializeGameSessionsDocument(document)));
    expect(sentBytes).toBeGreaterThan(compactBytes);
    expect(sentBytes).toBeLessThan(GAME_SESSIONS_SIZE_WARNING_BYTES);
    expect(GAME_SESSIONS_SIZE_WARNING_BYTES).toBe(750 * 1024);
    expect(sentBytes >= GAME_SESSIONS_SIZE_WARNING_BYTES).toBe(false);
  });

  it('indicador da UI usa o tamanho do PATCH', () => {
    const document = nestedAccentDocument();
    const sentBytes = utf8TextSize(serializeGameSessionsDocument(document));
    const label = `Encontros: ${formatFileSize(gameSessionsPatchUtf8Size(document))}`;
    expect(label).toBe(`Encontros: ${formatFileSize(sentBytes)}`);
  });
});

describe('formatFileSize', () => {
  it('formata bytes abaixo de 1 KiB', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(24)).toBe('24 B');
  });

  it('formata KB com vírgula decimal pt-BR', () => {
    expect(formatFileSize(Math.round(24.3 * 1024))).toBe('24,3 KB');
  });

  it('formata MB acima de 1 MiB', () => {
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2,0 MB');
  });

  it('trata valores inválidos como zero', () => {
    expect(formatFileSize(Number.NaN)).toBe('0 B');
    expect(formatFileSize(-10)).toBe('0 B');
  });
});

describe('competitionsPatchUtf8Size', () => {
  it('mede o JSON pretty-print enviado no PATCH', () => {
    const document = createEmptyCompetitionDocument();
    const serialized = serializeCompetitionsDocument(document);
    expect(competitionsPatchUtf8Size(document)).toBe(utf8TextSize(serialized));
    expect(competitionsPatchUtf8Size(document)).toBeLessThan(COMPETITIONS_SIZE_WARNING_BYTES);
  });
});
