import { ChangeDetectionStrategy, Component, afterNextRender, input, output, signal } from '@angular/core';

@Component({
  selector: 'app-toggle-switch',
  templateUrl: './toggle-switch.html',
  styleUrl: './toggle-switch.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToggleSwitch {
  readonly checked = input(false);
  readonly disabled = input(false);
  readonly checkedChange = output<boolean>();

  protected readonly isReady = signal(false);

  constructor() {
    afterNextRender(() => setTimeout(() => this.isReady.set(true)));
  }

  protected onToggle(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    const requested = checkbox.checked;
    checkbox.checked = this.checked();
    this.checkedChange.emit(requested);
  }
}
