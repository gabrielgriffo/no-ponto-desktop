import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-range-slider',
  templateUrl: './range-slider.html',
  styleUrl: './range-slider.css',
})
export class RangeSlider {
  @Input() value: number = 0;
  @Input() min: number = 0;
  @Input() max: number = 100;
  @Input() step: number = 1;
  @Input() disabled: boolean = false;
  @Input() ariaLabel: string = '';

  @Output() valueChange = new EventEmitter<number>();

  @Output() commit = new EventEmitter<number>();

  get trackBackground(): string {
    const span = this.max - this.min;
    const ratio = span > 0 ? (this.value - this.min) / span : 0;
    const percent = Math.min(100, Math.max(0, ratio * 100));
    return `linear-gradient(to right,
      var(--primary-green) 0%, var(--primary-green) ${percent}%,
      var(--bg-light) ${percent}%, var(--bg-light) 100%)`;
  }

  onInput(event: Event): void {
    this.value = Number((event.target as HTMLInputElement).value);
    this.valueChange.emit(this.value);
  }

  onCommit(): void {
    this.commit.emit(this.value);
  }
}
