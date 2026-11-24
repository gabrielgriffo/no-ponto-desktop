import { describe, expect, it } from 'vitest';
import { caretAfterFormat } from './time-input.directive';
import { TimeUtilsService } from '../services/time-utils.service';

const format = (raw: string) => new TimeUtilsService().formatTimeInput(raw);
const digitsAfter = (text: string, caret: number) => text.slice(caret).replace(/\D/g, '');

describe('caretAfterFormat', () => {
  it('digitando no fim, o cursor continua no fim', () => {
    const formatted = format('083');
    expect(caretAfterFormat('083', 3, formatted)).toBe(formatted.length);
  });

  it('editando no meio, os dígitos depois do cursor continuam depois dele', () => {
    for (const [raw, caret] of [['0830', 1], ['08:30', 4], ['1:30', 1], ['0830', 2]] as const) {
      const formatted = format(raw);
      const result = caretAfterFormat(raw, caret, formatted);
      expect(digitsAfter(formatted, result), `${raw} -> ${formatted}`).toBe(digitsAfter(raw, caret));
    }
  });

  it('o zero acrescentado pela formatação fica antes do cursor', () => {
    expect(format('1:30')).toBe('01:30');
    expect(caretAfterFormat('1:30', 1, '01:30')).toBe(2);
  });

  it('com o cursor no início, ele continua no início', () => {
    expect(caretAfterFormat('0830', 0, format('0830'))).toBe(0);
  });
});
