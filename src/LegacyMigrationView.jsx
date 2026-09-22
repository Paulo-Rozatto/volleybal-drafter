import { useMemo, useRef, useState } from 'react';
import AuthPanel from './AuthPanel.jsx';
import LegacyMigrationPreview from './LegacyMigrationPreview.jsx';
import LegacyMigrationProgress from './LegacyMigrationProgress.jsx';
import LegacyMigrationReport from './LegacyMigrationReport.jsx';
import LegacyPlayerMapping from './LegacyPlayerMapping.jsx';
import {
  canStartImport,
  downloadLegacySnapshotFile,
  itemsToImport,
  migrationSourceType,
  nextMigrationStep,
  previousMigrationStep,
} from './legacyMigrationPanel.js';
import {
  buildLegacyMigrationPlan,
  fingerprintLegacySnapshot,
  serializeLegacySnapshot,
  verifyImportedCompetition,
  verifyImportedSession,
} from './migration/legacyMigration.js';
import {
  fetchLegacyImportCloudState,
  finishLegacyImportBatch,
  importLegacyCompetition,
  importLegacyPlayer,
  importLegacySession,
  loadImportedCompetition,
  loadImportedSession,
  startLegacyImportBatch,
} from './supabase/legacyImportApi.js';

export default function LegacyMigrationView({
  configured,
  ready,
  user,
  players,
  gameSessions,
  competitions,
  gistLoaded,
  onBack,
}) {
  const [step, setStep] = useState('origin');
  const [plan, setPlan] = useState(null);
  const [fingerprint, setFingerprint] = useState('');
  const [decisions, setDecisions] = useState({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({
    phase: '',
    playerDone: 0,
    playerTotal: 0,
    sessionDone: 0,
    sessionTotal: 0,
    competitionDone: 0,
    competitionTotal: 0,
    cancelled: false,
  });
  const [results, setResults] = useState([]);
  const cancelRef = useRef(false);
  const sourceType = migrationSourceType(gistLoaded);
  const snapshot = useMemo(
    () => ({ players, sessions: gameSessions, competitions }),
    [players, gameSessions, competitions]
  );

  const resolvedPlan = useMemo(() => {
    if (!plan) return null;
    return buildLegacyMigrationPlan({
      players,
      sessionsDocument: gameSessions,
      competitionsDocument: competitions,
      cloudState: plan.cloudState,
      playerDecisions: decisions,
    });
  }, [plan, players, gameSessions, competitions, decisions]);

  async function analyze() {
    setBusy(true);
    setStatus('');
    const cloudState = await fetchLegacyImportCloudState();
    if (!cloudState.ok) {
      setBusy(false);
      setStatus(cloudState.error?.message || 'Não foi possível ler o estado cloud.');
      return;
    }
    const nextPlan = buildLegacyMigrationPlan({
      players,
      sessionsDocument: gameSessions,
      competitionsDocument: competitions,
      cloudState,
      playerDecisions: decisions,
    });
    nextPlan.cloudState = cloudState;
    const hash = await fingerprintLegacySnapshot(snapshot);
    setFingerprint(hash);
    setPlan(nextPlan);
    setBusy(false);
    setStep('analyze');
  }

  function downloadSnapshot() {
    downloadLegacySnapshotFile(
      'cortada-legado.json',
      serializeLegacySnapshot(snapshot)
    );
  }

  async function runImport(filterFailed = null) {
    if (!resolvedPlan || !canStartImport(resolvedPlan)) return;
    cancelRef.current = false;
    setBusy(true);
    setStatus('');
    setStep('migrate');
    const playersQueue = itemsToImport(resolvedPlan, 'players').filter((item) =>
      filterFailed ? filterFailed.has(`player:${item.legacyId}`) : true
    );
    const sessionsQueue = itemsToImport(resolvedPlan, 'sessions').filter((item) =>
      filterFailed ? filterFailed.has(`session:${item.legacyId}`) : true
    );
    const competitionsQueue = itemsToImport(resolvedPlan, 'competitions').filter((item) =>
      filterFailed ? filterFailed.has(`competition:${item.legacyId}`) : true
    );
    setProgress({
      phase: 'Jogadores',
      playerDone: 0,
      playerTotal: playersQueue.length,
      sessionDone: 0,
      sessionTotal: sessionsQueue.length,
      competitionDone: 0,
      competitionTotal: competitionsQueue.length,
      cancelled: false,
    });

    const started = await startLegacyImportBatch(sourceType, fingerprint);
    if (!started.ok) {
      setBusy(false);
      setStatus(started.error?.message || 'Não foi possível iniciar o lote.');
      return;
    }
    const batchId = started.batchId;
    const nextResults = filterFailed ? results.filter((item) => item.ok !== false) : [];
    const playerMap = new Map(
      (resolvedPlan.cloudState?.playerMappings ?? []).map((row) => [
        row.legacy_player_id,
        row.cloud_player_id,
      ])
    );

    for (const item of playersQueue) {
      if (cancelRef.current) break;
      const decision = decisions[item.legacyId];
      const imported = await importLegacyPlayer({
        legacyPlayerId: item.legacyId,
        name: item.player?.name ?? item.name,
        skillScore: item.player?.score,
        gender: item.player?.gender,
        height: item.player?.height,
        cloudPlayerId: decision?.action === 'associate' ? decision.cloudPlayerId : null,
        batchId,
      });
      if (imported.ok) {
        playerMap.set(item.legacyId, imported.cloud_id);
        nextResults.push({
          ok: true,
          entityType: 'player',
          legacyId: item.legacyId,
          name: item.name,
          status: imported.status,
          cloudId: imported.cloud_id,
        });
      } else {
        nextResults.push({
          ok: false,
          entityType: 'player',
          legacyId: item.legacyId,
          name: item.name,
          errorCode: imported.error?.code,
          error: imported.error,
        });
      }
      setProgress((current) => ({ ...current, playerDone: current.playerDone + 1 }));
    }

    for (const item of sessionsQueue) {
      if (cancelRef.current) break;
      const imported = await importLegacySession({
        legacyId: item.legacyId,
        document: item.session,
        batchId,
      });
      if (!imported.ok) {
        nextResults.push({
          ok: false,
          entityType: 'session',
          legacyId: item.legacyId,
          name: item.name,
          errorCode: imported.error?.code,
          error: imported.error,
        });
      } else if (imported.status === 'already_imported') {
        nextResults.push({
          ok: true,
          entityType: 'session',
          legacyId: item.legacyId,
          name: item.name,
          status: 'already_imported',
          cloudId: imported.cloud_id,
        });
      } else {
        const loaded = await loadImportedSession(imported.cloud_id, user.id);
        const verified = loaded.ok
          ? verifyImportedSession(item.session, loaded.session, playerMap)
          : { ok: false, mismatches: ['reload'] };
        nextResults.push({
          ok: verified.ok,
          entityType: 'session',
          legacyId: item.legacyId,
          name: item.name,
          status: imported.status,
          cloudId: imported.cloud_id,
          errorCode: verified.ok ? null : 'IMPORT_FAILED',
        });
      }
      setProgress((current) => ({
        ...current,
        phase: 'Encontros',
        sessionDone: current.sessionDone + 1,
      }));
    }

    for (const item of competitionsQueue) {
      if (cancelRef.current) break;
      const imported = await importLegacyCompetition({
        legacyId: item.legacyId,
        document: item.competition,
        batchId,
      });
      if (!imported.ok) {
        nextResults.push({
          ok: false,
          entityType: 'competition',
          legacyId: item.legacyId,
          name: item.name,
          errorCode: imported.error?.code,
          error: imported.error,
        });
      } else if (imported.status === 'already_imported') {
        nextResults.push({
          ok: true,
          entityType: 'competition',
          legacyId: item.legacyId,
          name: item.name,
          status: 'already_imported',
          cloudId: imported.cloud_id,
        });
      } else {
        const loaded = await loadImportedCompetition(imported.cloud_id, user.id);
        const verified = loaded.ok
          ? verifyImportedCompetition(item.competition, loaded.loaded?.competition ?? loaded.competition, playerMap)
          : { ok: false, mismatches: ['reload'] };
        nextResults.push({
          ok: verified.ok,
          entityType: 'competition',
          legacyId: item.legacyId,
          name: item.name,
          status: imported.status,
          cloudId: imported.cloud_id,
          errorCode: verified.ok ? null : 'IMPORT_FAILED',
        });
      }
      setProgress((current) => ({
        ...current,
        phase: 'Competições',
        competitionDone: current.competitionDone + 1,
      }));
    }

    await finishLegacyImportBatch(batchId, cancelRef.current ? 'cancelled' : 'completed');
    setResults(nextResults);
    setProgress((current) => ({ ...current, cancelled: cancelRef.current, phase: 'Concluído' }));
    setBusy(false);
    setStep('result');
  }

  if (!configured || !ready || !user) {
    return (
      <div className="space-y-4">
        <button type="button" className="text-sm font-bold cursor-pointer" style={{ color: 'var(--primary)' }} onClick={onBack}>
          ← Voltar
        </button>
        <h2 className="text-xl font-bold">Migrar dados antigos</h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          A importação exige login. Nenhum dado do Gist será apagado.
        </p>
        <AuthPanel configured={configured} ready={ready} user={user} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button type="button" className="text-sm font-bold cursor-pointer" style={{ color: 'var(--primary)' }} onClick={onBack}>
        ← Voltar
      </button>
      <h2 className="text-xl font-bold">Migrar dados antigos</h2>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Importação unidirecional para o cloud. Nenhum dado do Gist será apagado. Não é sincronização permanente.
      </p>

      {step === 'origin' && (
        <div className="space-y-3">
          <p className="text-sm">
            O App analisa o elenco, os encontros e as competições já carregados neste navegador.
          </p>
          <button
            type="button"
            className="w-full font-bold py-2 rounded-lg text-sm cursor-pointer"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
            onClick={downloadSnapshot}
          >
            Baixar snapshot do legado
          </button>
          <button
            type="button"
            disabled={busy}
            className="w-full font-bold py-2 rounded-lg text-sm cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
            onClick={analyze}
          >
            Analisar
          </button>
        </div>
      )}

      {step === 'analyze' && resolvedPlan && (
        <div className="space-y-3">
          <LegacyMigrationPreview plan={resolvedPlan} fingerprint={fingerprint} sourceType={sourceType} />
          <button
            type="button"
            className="text-sm font-bold cursor-pointer"
            style={{ color: 'var(--primary)' }}
            onClick={() => setStep(nextMigrationStep('analyze'))}
          >
            Resolver jogadores
          </button>
        </div>
      )}

      {step === 'players' && resolvedPlan && (
        <div className="space-y-3">
          <LegacyPlayerMapping
            players={resolvedPlan.players}
            onDecision={(legacyId, decision) =>
              setDecisions((current) => ({ ...current, [legacyId]: decision }))
            }
          />
          <button
            type="button"
            className="text-sm font-bold cursor-pointer"
            style={{ color: 'var(--primary)' }}
            onClick={() => setStep(nextMigrationStep('players'))}
            disabled={!canStartImport(resolvedPlan)}
          >
            Revisar
          </button>
        </div>
      )}

      {step === 'review' && resolvedPlan && (
        <div className="space-y-3">
          <LegacyMigrationPreview plan={resolvedPlan} fingerprint={fingerprint} sourceType={sourceType} />
          <p className="text-sm font-semibold">Encontros e competições importados começam avulsos (sem grupo).</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 font-bold py-2 rounded-lg text-sm cursor-pointer"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
              onClick={() => runImport()}
              disabled={!canStartImport(resolvedPlan) || busy}
            >
              Migrar tudo
            </button>
            <button
              type="button"
              className="text-sm font-bold cursor-pointer"
              style={{ color: 'var(--primary)' }}
              onClick={() => setStep(previousMigrationStep('review'))}
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      {step === 'migrate' && (
        <div className="space-y-3">
          <LegacyMigrationProgress {...progress} />
          <button
            type="button"
            className="text-sm font-bold cursor-pointer"
            style={{ color: 'var(--primary)' }}
            onClick={() => {
              cancelRef.current = true;
            }}
          >
            Cancelar novos itens
          </button>
        </div>
      )}

      {step === 'result' && (
        <div className="space-y-3">
          <LegacyMigrationProgress {...progress} />
          <LegacyMigrationReport
            results={results}
            onRetryFailed={() => {
              const failed = new Set(
                results.filter((item) => item.ok === false).map((item) => `${item.entityType}:${item.legacyId}`)
              );
              runImport(failed);
            }}
          />
        </div>
      )}

      {status ? <p className="text-sm font-semibold text-red-500">{status}</p> : null}
    </div>
  );
}
