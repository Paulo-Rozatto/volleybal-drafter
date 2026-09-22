export const LEGACY_MIGRATION_STEPS = Object.freeze([
  'origin',
  'analyze',
  'players',
  'review',
  'migrate',
  'result',
]);

export function nextMigrationStep(current) {
  const index = LEGACY_MIGRATION_STEPS.indexOf(current);
  if (index < 0 || index >= LEGACY_MIGRATION_STEPS.length - 1) return current;
  return LEGACY_MIGRATION_STEPS[index + 1];
}

export function previousMigrationStep(current) {
  const index = LEGACY_MIGRATION_STEPS.indexOf(current);
  if (index <= 0) return 'origin';
  return LEGACY_MIGRATION_STEPS[index - 1];
}

export function migrationSourceType(gistLoaded) {
  return gistLoaded ? 'gist' : 'localStorage';
}

export function canStartImport(plan) {
  if (!plan) return false;
  if (plan.schemaError) return false;
  if ((plan.players ?? []).some((item) => item.status === 'NEEDS_PLAYER_MAPPING')) return false;
  return true;
}

export function itemsToImport(plan, entityType) {
  return (plan?.[entityType] ?? []).filter((item) => item.status === 'NEW');
}

export function formatMigrationProgress(done, total) {
  return `${done} / ${total}`;
}

export function downloadLegacySnapshotFile(filename, contents) {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
