export function applyPlayersOperation({
  getPlayers,
  setPlayers,
  persistPlayers,
  markPending,
  operation,
}) {
  const current = getPlayers();
  const result = operation(current);
  if (!result?.ok) {
    return result;
  }

  if (result.unchanged) {
    return {
      ...result,
      persistOk: true,
      persistError: null,
    };
  }

  const persistResult = persistPlayers(result.players);
  if (!persistResult?.ok) {
    setPlayers(result.players);
    markPending();
    return {
      ...result,
      persistOk: false,
      persistError: persistResult?.error || 'Não foi possível salvar o cache local de jogadores.',
    };
  }

  setPlayers(result.players);
  markPending();
  return {
    ...result,
    persistOk: true,
    persistError: null,
  };
}
