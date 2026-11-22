import { describe, expect, it } from 'vitest';
import { timeToMinutes, validateTimes } from './time-validation';

describe('validateTimes', () => {
  it('aceita horários em ordem', () => {
    expect(validateTimes('08:00', '12:00', '13:00')).toEqual({ fields: [], message: null });
    expect(validateTimes('08:00', '', '')).toEqual({ fields: [], message: null });
  });

  it('exige a entrada quando tudo está vazio', () => {
    expect(validateTimes('', '', '')).toEqual({
      fields: ['checkIn'],
      message: 'Horário de entrada não informado',
    });
  });

  it('formato inválido é avisado antes da ordem', () => {
    expect(validateTimes('8:0', '07:00', '')).toEqual({
      fields: ['checkIn'],
      message: 'Formato de horário de entrada inválido',
    });
  });

  it('vários formatos inválidos viram mensagem genérica', () => {
    expect(validateTimes('8', '9', '')).toEqual({
      fields: ['checkIn', 'checkOut'],
      message: 'Horários informados com erro',
    });
  });

  it('saída antes da entrada', () => {
    expect(validateTimes('10:00', '09:00', '')).toEqual({
      fields: ['checkOut'],
      message: 'Horário de saída anterior ao de entrada',
    });
  });

  it('retorno sem entrada nem saída marca os dois campos com a mesma mensagem', () => {
    expect(validateTimes('', '', '13:00')).toEqual({
      fields: ['checkIn', 'checkOut'],
      message: 'Horários de entrada e saída não informados',
    });
  });

  it('erros com mensagens diferentes viram mensagem genérica', () => {
    expect(validateTimes('', '12:00', '11:00')).toEqual({
      fields: ['checkIn', 'checkIn2'],
      message: 'Horários informados com erro',
    });
  });
});

describe('timeToMinutes', () => {
  it('converte apenas HH:MM completo', () => {
    expect(timeToMinutes('01:30')).toBe(90);
    expect(timeToMinutes('1:30')).toBe(-1);
    expect(timeToMinutes('ab:cd')).toBe(-1);
  });
});
