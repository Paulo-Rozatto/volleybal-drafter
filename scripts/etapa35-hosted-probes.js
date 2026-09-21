/* Etapa 3.5 — colar no console do Vite (DEV) logado como o usuário sob teste.
 *
 * Duas abas do mesmo perfil NÃO são dois usuários. Auth do Supabase fica em localStorage.
 * André e Paulo: Firefox + Chrome, ou dois perfis de navegador.
 * Concorrência de placar: duas abas do MESMO usuário com permissão, ou dois membros que podem marcar.
 *
 * Preencha os IDs e rode um bloco por vez. Esperado: erro no banco, não só botão escondido.
 */

const supabase = globalThis.__paDreSupabase?.();
if (!supabase) throw new Error('Cliente ausente. Preencha .env real e reinicie o Vite.');

const SESSION_ID = 'uuid-do-encontro';
const MATCH_ID = 'uuid-da-partida';
const PLAYER_ID = 'uuid-do-player-de-terceiro';
const CLAIM_ID = 'uuid-do-claim';
const STRUCTURE_VERSION = 0;
const MATCH_VERSION = 0;

async function show(label, run) {
  const { data, error } = await run();
  console.log(label, { data, error: error?.message ?? null });
  return { data, error };
}

// RLS negativo (rode logado como viewer / member / outsider, conforme o caso)
await show('viewer set_match_score', () =>
  supabase.rpc('set_match_score', {
    p_match_id: MATCH_ID,
    p_score_a: 21,
    p_score_b: 18,
    p_expected_version: MATCH_VERSION,
  })
);

await show('member replace_session_teams', () =>
  supabase.rpc('replace_session_teams', {
    p_session_id: SESSION_ID,
    p_expected_structure_version: STRUCTURE_VERSION,
    p_teams: [],
  })
);

await show('member finalize_session', () =>
  supabase.rpc('finalize_session', {
    p_session_id: SESSION_ID,
    p_expected_structure_version: STRUCTURE_VERSION,
  })
);

await show('outsider sessions select', () =>
  supabase.from('sessions').select('id, name').eq('id', SESSION_ID)
);

await show('link_player de terceiro', () =>
  supabase.rpc('link_player', { p_player_id: PLAYER_ID })
);

await show('approve_player_link_claim de terceiro', () =>
  supabase.rpc('approve_player_link_claim', { p_claim_id: CLAIM_ID })
);

// Concorrência de placar: A já salvou 21×18 e version=1; B ainda manda expected 0
await show('SCORE_VERSION_CONFLICT', () =>
  supabase.rpc('set_match_score', {
    p_match_id: MATCH_ID,
    p_score_a: 21,
    p_score_b: 19,
    p_expected_version: 0,
  })
);

await show('match_events', () =>
  supabase
    .from('match_events')
    .select('event_type, new_score_a, new_score_b, match_version_before, match_version_after')
    .eq('match_id', MATCH_ID)
    .order('created_at')
);
