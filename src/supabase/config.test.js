import { describe, expect, it } from 'vitest';
import { looksLikeSupabasePlaceholder } from './config.js';

describe('isSupabaseConfigured placeholders', () => {
  it('recusa o .env.example e não trata service_role como assunto do Vite', () => {
    expect(
      looksLikeSupabasePlaceholder('https://YOUR_PROJECT.supabase.co', 'YOUR_ANON_KEY')
    ).toBe(true);
    expect(
      looksLikeSupabasePlaceholder('https://SEU-PROJETO.supabase.co', 'SUA_ANON_KEY')
    ).toBe(true);
    expect(
      looksLikeSupabasePlaceholder('https://abcd.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon')
    ).toBe(false);
  });
});
