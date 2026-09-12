import { serializeGameSessionsDocument } from './gameSessionsDocument.js';

export const GAME_SESSIONS_SIZE_WARNING_BYTES = 750 * 1024;

export function utf8TextSize(serializedText) {
  if (typeof serializedText !== 'string') {
    throw new Error('O conteúdo serializado precisa ser uma string.');
  }
  return new TextEncoder().encode(serializedText).byteLength;
}

export function gameSessionsPatchUtf8Size(gameSessions) {
  return utf8TextSize(serializeGameSessionsDocument(gameSessions));
}

export function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) {
    return '0 B';
  }

  if (size < 1024) {
    return `${Math.round(size)} B`;
  }

  if (size < 1024 * 1024) {
    return `${formatDecimal(size / 1024)} KB`;
  }

  return `${formatDecimal(size / (1024 * 1024))} MB`;
}

function formatDecimal(value) {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
