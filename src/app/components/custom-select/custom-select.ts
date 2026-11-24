import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';

export interface SelectOption<T = any> {
  label: string;
  value: T;
}

@Component({
  selector: 'app-custom-select',
  templateUrl: './custom-select.html',
  styleUrl: './custom-select.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick($event)' },
})
export class CustomSelect<T = any> {
  readonly options = input<SelectOption<T>[]>([]);
  readonly value = input<T>();
  readonly placeholder = input('Selecione...');
  readonly valueChange = output<T>();

  protected readonly isOpen = signal(false);
  protected readonly displayValue = computed(
    () => this.options().find(option => option.value === this.value())?.label || this.placeholder()
  );

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected toggleDropdown(): void {
    this.isOpen.update(open => !open);
  }

  protected selectOption(option: SelectOption<T>): void {
    this.isOpen.set(false);
    if (option.value !== this.value()) this.valueChange.emit(option.value);
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.isOpen() && !this.host.nativeElement.contains(event.target as Node)) {
      this.isOpen.set(false);
    }
  }
}
