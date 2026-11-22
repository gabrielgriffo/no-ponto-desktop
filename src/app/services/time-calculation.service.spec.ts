import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeCalculationService } from './time-calculation.service';

const at = (hours: number, minutes: number) => new Date(2026, 10, 22, hours, minutes);
const hhmm = ({ hours, minutes }: { hours: number; minutes: number }) =>
  `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

describe('TimeCalculationService', () => {
  const service = new TimeCalculationService();

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('só com a entrada, soma o intervalo presumido ao fim do expediente', () => {
    vi.setSystemTime(at(10, 0));
    const result = service.calculateWorkTime('08:00', '', '', '', 480, 60);

    expect(hhmm(result.workedTime)).toBe('02:00');
    expect(hhmm(result.remainingTime)).toBe('06:00');
    expect(hhmm(result.endTime)).toBe('17:00');
    expect(result.lunchHourAdded).toBe(true);
  });

  it('no intervalo, o fim considera a volta prevista', () => {
    vi.setSystemTime(at(12, 30));
    const result = service.calculateWorkTime('08:00', '12:00', '', '', 480, 60);

    expect(hhmm(result.workedTime)).toBe('04:00');
    expect(hhmm(result.endTime)).toBe('17:00');
  });

  it('com o retorno batido, conta o segundo período até agora', () => {
    vi.setSystemTime(at(15, 0));
    const result = service.calculateWorkTime('08:00', '12:00', '13:00', '', 480, 60);

    expect(hhmm(result.secondPeriod)).toBe('02:00');
    expect(hhmm(result.workedTime)).toBe('06:00');
    expect(hhmm(result.endTime)).toBe('17:00');
    expect(result.lunchHourAdded).toBe(false);
  });

  it('com a saída final, o tempo para de correr', () => {
    vi.setSystemTime(at(20, 0));
    const result = service.calculateWorkTime('08:00', '12:00', '13:00', '17:00', 480, 60);

    expect(hhmm(result.workedTime)).toBe('08:00');
    expect(hhmm(result.remainingTime)).toBe('00:00');
    expect(hhmm(result.endTime)).toBe('17:00');
  });

  it('hora extra antes do intervalo não empurra o fim pela duração do intervalo', () => {
    vi.setSystemTime(at(17, 30));
    const result = service.calculateWorkTime('08:00', '16:30', '17:00', '', 480, 60);

    expect(hhmm(result.endTime)).toBe('16:00');
  });

  it('mais de quatro batidas somam os pares e deixam o último período aberto', () => {
    vi.setSystemTime(at(19, 0));
    const result = service.calculateWorkTime('08:00', '12:00', '13:00', '16:00', 480, 60, ['18:00']);

    expect(hhmm(result.workedTime)).toBe('08:00');
    expect(hhmm(result.endTime)).toBe('19:00');
  });

  it('jornada inválida cai no padrão de 8 horas', () => {
    vi.setSystemTime(at(9, 0));
    const result = service.calculateWorkTime('08:00', '', '', '', 0, 0);

    expect(hhmm(result.remainingTime)).toBe('07:00');
    expect(result.lunchHourAdded).toBe(false);
  });

  it('meia-noite é um horário válido', () => {
    expect(service.timeStringToMinutes('00:00')).toBe(0);
    expect(service.timeStringToMinutes('')).toBe(-1);
  });
});
