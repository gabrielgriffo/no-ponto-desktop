import { describe, expect, it } from 'vitest';
import { closedDayState, isWorkdayReopened, shouldRingAlarm } from './alarm.service';

describe('closedDayState', () => {
  it('café antes do almoço é pausa, não encerramento', () => {
    expect(closedDayState(4, 225, 480)).toBe('pausado');
  });

  it('jornada curta sem intervalo encerra com duas batidas', () => {
    expect(closedDayState(2, 360, 360)).toBe('terminou');
  });

  it('quatro batidas que cumprem a jornada encerram o dia', () => {
    expect(closedDayState(4, 480, 480)).toBe('terminou');
  });

  it('par aberto ou dia sem batidas não é decidido aqui', () => {
    expect(closedDayState(0, 0, 480)).toBeNull();
    expect(closedDayState(3, 600, 480)).toBeNull();
  });
});

describe('isWorkdayReopened', () => {
  it('saída depois de cumprir a jornada não reabre o dia', () => {
    expect(isWorkdayReopened('extra', 'pausado', 540, 480)).toBe(false);
  });

  it('jornada aumentada nas configurações reabre o dia', () => {
    expect(isWorkdayReopened('extra', 'andamento', 500, 540)).toBe(true);
  });

  it('só reabre quem estava em hora extra', () => {
    expect(isWorkdayReopened('andamento', 'pausado', 100, 480)).toBe(false);
  });
});

describe('alarme no mesmo dia', () => {
  it('não toca de novo na volta de uma pausa depois da jornada cumprida', () => {
    const afterLeaving = closedDayState(2, 600, 480) ?? 'andamento';
    expect(afterLeaving).toBe('terminou');
    expect(isWorkdayReopened('extra', afterLeaving, 600, 480)).toBe(false);
    expect(shouldRingAlarm(afterLeaving, 'extra')).toBe(false);
  });
});
