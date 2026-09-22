import { describe, expect, it } from 'vitest';
import { parseScoreField, scoreFieldsToValues, messageForScoreErrors } from './scoreInput.js';

describe('parseScoreField', () => {
  it('não converte string vazia em zero', () => {
    expect(parseScoreField('')).toEqual({ empty: true, value: null });
    expect(parseScoreField('   ')).toEqual({ empty: true, value: null });
    expect(Number('')).toBe(0);
  });

  it('converte inteiros válidos, inclusive zero', () => {
    expect(parseScoreField('21')).toEqual({ empty: false, value: 21 });
    expect(parseScoreField(' 18 ')).toEqual({ empty: false, value: 18 });
    expect(parseScoreField('0')).toEqual({ empty: false, value: 0 });
  });

  it('mantém decimal e texto como inválidos para o domínio', () => {
    expect(parseScoreField('21.5')).toEqual({ empty: false, value: '21.5' });
    expect(parseScoreField('abc')).toEqual({ empty: false, value: 'abc' });
    expect(parseScoreField('1e2')).toEqual({ empty: false, value: '1e2' });
    expect(parseScoreField('Infinity')).toEqual({ empty: false, value: 'Infinity' });
  });
});

describe('scoreFieldsToValues', () => {
  it('preserva vazios como null sem virar zero', () => {
    expect(scoreFieldsToValues('', '18')).toEqual({ scoreA: null, scoreB: 18 });
    expect(scoreFieldsToValues('21', '  ')).toEqual({ scoreA: 21, scoreB: null });
  });
});

describe('messageForScoreErrors', () => {
  it('mapeia códigos de validateScore para mensagens da UI', () => {
    expect(messageForScoreErrors([{ code: 'SCORE_PARTIAL' }])).toBe('Preencha os dois lados do placar.');
    expect(messageForScoreErrors([{ code: 'SCORE_VERSION_CONFLICT' }])).toBe(
      'Este placar foi alterado em outro dispositivo. Atualizamos os dados para você.'
    );
    expect(messageForScoreErrors([{ code: 'SCORE_NEGATIVE' }])).toBe(
      'O placar deve usar números inteiros não negativos.'
    );
    expect(messageForScoreErrors([{ code: 'SCORE_NOT_INTEGER' }])).toBe(
      'O placar deve usar números inteiros não negativos.'
    );
    expect(messageForScoreErrors([{ code: 'SCORE_INVALID_TYPE' }])).toBe(
      'O placar deve usar números inteiros não negativos.'
    );
  });
});
