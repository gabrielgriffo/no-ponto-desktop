import { Directive, ElementRef, inject } from '@angular/core';
import { TimeUtilsService } from '../services/time-utils.service';

@Directive({
  selector: '[appTimeInput]',
  host: { '(input)': 'onInput()' },
})
export class TimeInputDirective {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private readonly timeUtils = inject(TimeUtilsService);

  protected onInput(): void {
    const input = this.el.nativeElement;
    const raw = input.value;
    const formatted = this.timeUtils.formatTimeInput(raw);
    if (formatted === raw) return;

    const caret = caretAfterFormat(raw, input.selectionStart ?? raw.length, formatted);
    input.value = formatted;
    input.setSelectionRange(caret, caret);
  }
}

export function caretAfterFormat(raw: string, caret: number, formatted: string): number {
  const isDigit = (char: string | undefined) => !!char && char >= '0' && char <= '9';
  const digitsAfter = raw.slice(caret).replace(/\D/g, '').length;
  if (digitsAfter === 0) return formatted.length;

  let seen = 0;
  for (let i = formatted.length - 1; i >= 0; i--) {
    if (!isDigit(formatted[i]) || ++seen < digitsAfter) continue;
    let position = i;
    while (position > 0 && !isDigit(formatted[position - 1])) position--;
    return position;
  }
  return 0;
}
