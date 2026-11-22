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
    input.value = this.timeUtils.formatTimeInput(input.value);
  }
}
