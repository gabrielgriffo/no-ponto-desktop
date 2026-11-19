import { Component, Input, Output, EventEmitter, HostListener, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface SelectOption {
  label: string;
  value: any;
}

@Component({
  selector: 'app-custom-select',
  imports: [CommonModule],
  templateUrl: './custom-select.html',
  styleUrl: './custom-select.css',
})
export class CustomSelect {
  @Input() options: SelectOption[] = [];
  @Input() value: any;
  @Input() placeholder: string = 'Selecione...';
  @Output() valueChange = new EventEmitter<any>();

  isOpen: boolean = false;

  private readonly host = inject(ElementRef<HTMLElement>);

  get selectedOption(): SelectOption | undefined {
    return this.options.find(opt => opt.value === this.value);
  }

  get displayValue(): string {
    return this.selectedOption?.label || this.placeholder;
  }

  toggleDropdown(): void {
    this.isOpen = !this.isOpen;
  }

  selectOption(option: SelectOption): void {
    this.value = option.value;
    this.valueChange.emit(this.value);
    this.isOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent): void {
    const clickedInside = this.host.nativeElement.contains(event.target as Node);
    if (!clickedInside && this.isOpen) {
      this.isOpen = false;
    }
  }
}
