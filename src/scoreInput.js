export const SCORE_UI_MESSAGES = {
  SCORE_PARTIAL: 'Preencha os dois lados do placar.',
  SCORE_TIE: 'O jogo não pode terminar empatado.',
  SCORE_NEGATIVE: 'O placar deve usar números inteiros não negativos.',
  SCORE_NOT_INTEGER: 'O placar deve usar números inteiros não negativos.',
  SCORE_INVALID_TYPE: 'O placar deve usar números inteiros não negativos.',
};

/**
 * Converte o texto do campo de placar sem transformar vazio em zero.
 * O valor validado no domínio ainda passa por `validateScore`.
 *
 * @param {unknown} raw
 * @returns {{ empty: boolean, value: number | null | string }}
 */
export function parseScoreField(raw) {
  if (raw == null) {
    return { empty: true, value: null };
  }

  const text = String(raw).trim();
  if (text === '') {
    return { empty: true, value: null };
  }

  if (!/^-?\d+$/.test(text)) {
    return { empty: false, value: text };
  }

  const parsed = Number(text);
  if (!Number.isInteger(parsed) || !Number.isFinite(parsed)) {
    return { empty: false, value: text };
  }

  return { empty: false, value: parsed };
}

export function scoreFieldsToValues(rawA, rawB) {
  const parsedA = parseScoreField(rawA);
  const parsedB = parseScoreField(rawB);
  return {
    scoreA: parsedA.value,
    scoreB: parsedB.value,
  };
}

export function messageForScoreErrors(errors) {
  const code = errors?.[0]?.code;
  return SCORE_UI_MESSAGES[code] || errors?.[0]?.message || 'Não foi possível salvar o placar.';
}
