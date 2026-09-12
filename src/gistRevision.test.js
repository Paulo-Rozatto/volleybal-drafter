import { describe, expect, it } from 'vitest';
import {
  extractGistRevision,
  GIST_REVISION_MISSING_MESSAGE,
} from './gistRevision.js';

describe('extractGistRevision', () => {
  it('prioriza history[0].version', () => {
    expect(
      extractGistRevision({
        history: [{ version: 'abc123' }, { version: 'older' }],
        updated_at: '2026-09-12T21:46:00Z',
      })
    ).toBe('version:abc123');
  });

  it('usa fallback updated_at quando não há version', () => {
    expect(extractGistRevision({ history: [], updated_at: '2026-09-12T21:46:00Z' })).toBe(
      'updated_at:2026-09-12T21:46:00Z'
    );
    expect(extractGistRevision({ updated_at: ' 2026-09-12T21:46:00Z ' })).toBe(
      'updated_at:2026-09-12T21:46:00Z'
    );
  });

  it('rejeita resposta sem revisão válida', () => {
    expect(() => extractGistRevision({})).toThrow(GIST_REVISION_MISSING_MESSAGE);
    expect(() => extractGistRevision({ history: [{ version: '  ' }], updated_at: '' })).toThrow(
      GIST_REVISION_MISSING_MESSAGE
    );
    expect(() => extractGistRevision({ files: { 'players.json': { content: '[]' } } })).toThrow(
      GIST_REVISION_MISSING_MESSAGE
    );
    expect(() => extractGistRevision(null)).toThrow(GIST_REVISION_MISSING_MESSAGE);
  });
});
