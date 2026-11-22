import { describe, expect, it } from 'vitest';
import { TimeCard, WorkDaysResponse } from '../services/pontomais.service';
import { hasTimeCards, todayLocalDate, validTimeCards } from './work-day';

function workDay(cards: { time: string; disabled?: boolean }[]): WorkDaysResponse {
  return {
    work_days: [{ time_cards: cards.map(card => ({ disabled: false, ...card }) as TimeCard) }],
    meta: { now: 0, ip: '', obfuscated: false },
  };
}

describe('validTimeCards', () => {
  it('ignora batidas revogadas e ordena por horário', () => {
    const cards = validTimeCards(workDay([{ time: '13:00' }, { time: '09:00', disabled: true }, { time: '08:00' }]));
    expect(cards.map(card => card.time)).toEqual(['08:00', '13:00']);
  });

  it('resposta vazia ou nula não tem batidas', () => {
    expect(validTimeCards(null)).toEqual([]);
    expect(hasTimeCards({ work_days: [], meta: { now: 0, ip: '', obfuscated: false } })).toBe(false);
  });
});

describe('todayLocalDate', () => {
  it('usa o fuso local, não UTC', () => {
    expect(todayLocalDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
