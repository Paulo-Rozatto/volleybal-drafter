export const ENTITY_STATUS_LABELS = Object.freeze({
  draft: 'Rascunho',
  in_progress: 'Em andamento',
  finished: 'Finalizado',
});

export const ROLE_LABELS = Object.freeze({
  owner: 'Dono',
  admin: 'Administrador',
  member: 'Membro',
  viewer: 'Visualizador',
});

export const CLAIM_STATUS_LABELS = Object.freeze({
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Recusado',
});

export function translateEntityStatus(status) {
  return ENTITY_STATUS_LABELS[status] ?? status ?? '';
}

export function translateRole(role) {
  return ROLE_LABELS[role] ?? role ?? '';
}

export function translateClaimStatus(status) {
  return CLAIM_STATUS_LABELS[status] ?? status ?? '';
}
