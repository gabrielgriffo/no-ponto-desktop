import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';

@Component({
  selector: 'app-range-slider',
  templateUrl: './range-slider.html',
  styleUrl: './range-slider.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RangeSlider {
  readonly value = model(0);
  readonly min = input(0);
  readonly max = input(100);
  readonly step = input(1);
  readonly disabled = input(false);
  readonly ariaLabel = input('');

  readonly commit = output<number>();

  protected readonly trackBackground = computed(() => {
    const span = this.max() - this.min();
    const ratio = span > 0 ? (this.value() - this.min()) / span : 0;
    const percent = Math.min(100, Math.max(0, ratio * 100));
    const fill = this.disabled() ? 'var(--disabled-bg)' : 'var(--accent-color)';
    return `linear-gradient(to right,
      ${fill} 0%, ${fill} ${percent}%,
      var(--bg-light) ${percent}%, var(--bg-light) 100%)`;
  });

  protected onInput(event: Event): void {
    this.value.set(Number((event.target as HTMLInputElement).value));
  }

  protected onCommit(): void {
    this.commit.emit(this.value());
  }
}
