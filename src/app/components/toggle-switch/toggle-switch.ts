import { Component, Input, Output, EventEmitter, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-toggle-switch',
  imports: [CommonModule],
  templateUrl: './toggle-switch.html',
  styleUrl: './toggle-switch.css',
})
export class ToggleSwitch implements AfterViewInit {
  @Input() checked: boolean = false;
  @Input() disabled: boolean = false;
  @Output() checkedChange = new EventEmitter<boolean>();

  isReady = false;

  ngAfterViewInit(): void {
    setTimeout(() => (this.isReady = true));
  }

  onToggle(event: Event): void {
    this.checked = (event.target as HTMLInputElement).checked;
    this.checkedChange.emit(this.checked);
  }
}
