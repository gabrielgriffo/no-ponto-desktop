import { Component, Input, Output, EventEmitter } from '@angular/core';
import { ToggleSwitch } from '../../../../components/toggle-switch/toggle-switch';
import { AppSettings } from '../../settings.model';

@Component({
  selector: 'app-system-settings',
  imports: [ToggleSwitch],
  templateUrl: './system-settings.html',
})
export class SystemSettingsComponent {
  @Input() settings!: AppSettings;
  @Output() settingsChange = new EventEmitter<void>();

  onChange(): void {
    this.settingsChange.emit();
  }
}
