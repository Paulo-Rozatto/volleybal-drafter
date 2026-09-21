export const CLOUD_RPC_ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: 'Entre na sua conta para continuar.',
  JOIN_CODE_INVALID: 'O código do convite é inválido.',
  JOIN_CODE_NOT_FOUND: 'Não encontramos um encontro com esse código.',
  JOIN_CODE_ROTATE_FORBIDDEN: 'Só o organizador pode trocar o código do encontro.',
  MATCH_NOT_FOUND: 'Partida não encontrada.',
  SCORE_FORBIDDEN: 'Você não pode registrar placar neste encontro.',
  SCORE_CLEAR_FORBIDDEN: 'Só o organizador pode limpar o placar.',
  SCORE_PARTIAL: 'Preencha os dois lados do placar.',
  SCORE_NEGATIVE: 'O placar deve usar números inteiros não negativos.',
  SCORE_TIE: 'O jogo não pode terminar empatado.',
  SCORE_VERSION_CONFLICT: 'O placar mudou em outro dispositivo. Recarregue e tente de novo.',
  USE_SET_MATCH_SCORE: 'O placar só pode ser gravado pela função de atualização.',
  USE_LINK_PLAYER: 'Vincule o jogador pela função de perfil.',
  PLAYER_NOT_FOUND: 'Jogador não encontrado.',
  PLAYER_ALREADY_LINKED: 'Este jogador já está vinculado a uma conta.',
  USER_ALREADY_LINKED: 'Sua conta já está vinculada a outro jogador.',
  PLAYER_LINK_REQUIRES_OWNERSHIP: 'Só é possível vincular um jogador que você criou.',
  STRUCTURE_VERSION_CONFLICT: 'O encontro mudou em outro dispositivo. Recarregue e tente de novo.',
  STRUCTURE_FORBIDDEN: 'Você não pode alterar a estrutura deste encontro.',
  SESSION_FINISHED: 'Este encontro já está finalizado.',
  SESSION_NOT_DRAFT: 'Só é possível alterar o elenco em um encontro em rascunho.',
  SESSION_NOT_IN_PROGRESS: 'Esta operação só vale para encontro em andamento.',
  TEAMS_LOCKED: 'Os times não podem ser alterados depois que as rodadas existem.',
  PLAYER_NOT_IN_SESSION: 'O jogador precisa estar no elenco do encontro.',
  FINALIZE_NO_MATCHES: 'Não há partidas para finalizar.',
  FINALIZE_INCOMPLETE: 'Todos os jogos precisam ter placar antes de finalizar.',
  SESSION_NOT_FOUND: 'Encontro não encontrado.',
  INVALID_PLAN: 'O plano do encontro é inválido.',
  PLAYER_ARCHIVED: 'Este jogador está arquivado.',
  PLAYER_IN_TEAM: 'Remova o jogador dos times antes de tirá-lo do encontro.',
  USE_STRUCTURE_RPC: 'A estrutura do encontro só pode ser gravada pela função correspondente.',
  STATUS_IMMUTABLE: 'O status do encontro só muda pelas funções de rodada e finalização.',
  PLAYER_NOT_LINKED: 'Sua conta ainda não está associada a um jogador.',
  PLAYER_NAME_REQUIRED: 'Informe um nome para criar o jogador.',
  PLAYER_CLAIM_NOT_VISIBLE: 'Você só pode reivindicar um jogador de um encontro que compartilha.',
  PLAYER_CLAIM_DUPLICATE: 'Já existe um pedido de vínculo pendente.',
  PLAYER_CLAIM_FORBIDDEN: 'Só quem criou o jogador pode decidir o pedido.',
  PLAYER_CLAIM_NOT_FOUND: 'Pedido de vínculo não encontrado.',
  PLAYER_CLAIM_NOT_PENDING: 'Este pedido já foi decidido.',
  GROUP_NAME_REQUIRED: 'Informe um nome para o grupo.',
  GROUP_NOT_FOUND: 'Grupo não encontrado.',
  GROUP_JOIN_CODE_NOT_FOUND: 'Não encontramos um grupo com esse código.',
  GROUP_JOIN_CODE_ROTATE_FORBIDDEN: 'Só o organizador ou um admin pode trocar o código do grupo.',
  GROUP_JOIN_CODE_ROTATE_REQUIRED: 'O código do grupo só muda pela função de convite.',
  GROUP_FORBIDDEN: 'Você não pode alterar este grupo.',
  GROUP_ROLE_INVALID: 'Papel de grupo inválido.',
  GROUP_ROLE_FORBIDDEN: 'Você não pode alterar esse papel.',
  GROUP_OWNER_IMMUTABLE: 'O organizador do grupo não pode ser alterado nesta etapa.',
  GROUP_LAST_OWNER: 'O grupo precisa continuar com um organizador.',
  GROUP_MEMBER_NOT_FOUND: 'Essa pessoa não pertence ao grupo.',
  GROUP_ID_IMMUTABLE: 'O encontro não pode mudar de grupo depois de criado.',
  GROUP_ACCESS_DENIED: 'Você não participa deste grupo.',
  JOIN_CODE_GENERATION_FAILED: 'Não foi possível gerar um código de convite. Tente de novo.',
});

export function rpcErrorCode(error) {
  const message = String(error?.message ?? error ?? '');
  const codes = Object.keys(CLOUD_RPC_ERROR_MESSAGES).sort((left, right) => right.length - left.length);
  const match = message.match(new RegExp(`(${codes.join('|')})`));
  return match?.[1] ?? null;
}

export function messageForCloudError(error) {
  const code = typeof error === 'string' ? error : rpcErrorCode(error) ?? error?.code;
  return CLOUD_RPC_ERROR_MESSAGES[code] ?? error?.message ?? 'Não foi possível concluir a operação.';
}
