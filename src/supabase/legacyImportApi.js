import { getSupabaseClient } from './client.js';
import { messageForCloudError, rpcErrorCode } from './errors.js';
import { loadCloudCompetition } from './competitionApi.js';
import { loadCloudSession } from './sessionApi.js';

function fail(error) {
  const code = rpcErrorCode(error) ?? error?.code ?? 'CLOUD_ERROR';
  return {
    ok: false,
    error: {
      code,
      message: messageForCloudError({ ...error, message: error?.message, code }),
    },
  };
}

function requireClient() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      supabase: null,
      error: fail({ code: 'SUPABASE_NOT_CONFIGURED', message: 'Supabase não está configurado.' }),
    };
  }
  return { supabase, error: null };
}

async function rpcOk(name, params = {}) {
  const { supabase, error } = requireClient();
  if (error) return error;
  const { data, error: rpcError } = await supabase.rpc(name, params);
  if (rpcError) return fail(rpcError);
  return { ok: true, data };
}

export async function fetchLegacyImportCloudState() {
  const { supabase, error } = requireClient();
  if (error) {
    return { ...error, playerMappings: [], sessions: [], competitions: [], mappablePlayers: [] };
  }

  const [mappings, sessions, competitions, mappable] = await Promise.all([
    supabase.from('legacy_player_mappings').select('legacy_player_id, cloud_player_id, created_at'),
    supabase
      .from('sessions')
      .select('id, name, date, status, legacy_source_id, group_id, created_by')
      .not('legacy_source_id', 'is', null),
    supabase
      .from('competitions')
      .select('id, name, date, status, legacy_source_id, group_id, created_by')
      .not('legacy_source_id', 'is', null),
    rpcOk('list_mappable_cloud_players'),
  ]);

  if (mappings.error) return { ...fail(mappings.error), playerMappings: [], sessions: [], competitions: [], mappablePlayers: [] };
  if (sessions.error) return { ...fail(sessions.error), playerMappings: [], sessions: [], competitions: [], mappablePlayers: [] };
  if (competitions.error) {
    return { ...fail(competitions.error), playerMappings: [], sessions: [], competitions: [], mappablePlayers: [] };
  }
  if (!mappable.ok) {
    return { ...mappable, playerMappings: [], sessions: [], competitions: [], mappablePlayers: [] };
  }

  return {
    ok: true,
    playerMappings: mappings.data ?? [],
    sessions: sessions.data ?? [],
    competitions: competitions.data ?? [],
    mappablePlayers: Array.isArray(mappable.data) ? mappable.data : [],
  };
}

export async function startLegacyImportBatch(sourceType, sourceFingerprint) {
  const result = await rpcOk('start_legacy_import_batch', {
    p_source_type: sourceType,
    p_source_fingerprint: sourceFingerprint ?? null,
  });
  if (!result.ok) return { ...result, batchId: null };
  return { ok: true, batchId: result.data };
}

export async function finishLegacyImportBatch(batchId, status) {
  return rpcOk('finish_legacy_import_batch', {
    p_batch_id: batchId,
    p_status: status,
  });
}

export async function importLegacyPlayer({
  legacyPlayerId,
  name,
  skillScore,
  gender,
  height,
  cloudPlayerId = null,
  batchId = null,
}) {
  const result = await rpcOk('import_legacy_player', {
    p_legacy_player_id: legacyPlayerId,
    p_name: name,
    p_skill_score: skillScore ?? null,
    p_gender: gender ?? null,
    p_height: height ?? null,
    p_cloud_player_id: cloudPlayerId,
    p_batch_id: batchId,
  });
  if (!result.ok) return { ...result, status: 'IMPORT_FAILED' };
  return { ok: true, ...result.data };
}

export async function importLegacySession({ legacyId, document, batchId = null }) {
  const result = await rpcOk('import_legacy_session', {
    p_legacy_id: legacyId,
    p_document: document,
    p_batch_id: batchId,
  });
  if (!result.ok) return { ...result, status: 'IMPORT_FAILED' };
  return { ok: true, ...result.data };
}

export async function importLegacyCompetition({ legacyId, document, batchId = null }) {
  const result = await rpcOk('import_legacy_competition', {
    p_legacy_id: legacyId,
    p_document: document,
    p_batch_id: batchId,
  });
  if (!result.ok) return { ...result, status: 'IMPORT_FAILED' };
  return { ok: true, ...result.data };
}

export async function loadImportedSession(cloudId, userId) {
  return loadCloudSession(cloudId, userId);
}

export async function loadImportedCompetition(cloudId, userId) {
  return loadCloudCompetition(cloudId, userId);
}
