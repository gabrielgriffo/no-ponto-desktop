import { Component, Input, Output, EventEmitter } from '@angular/core';
import { ToggleSwitch } from '../../../../components/toggle-switch/toggle-switch';
import { AppSettings } from '../../settings.model';

@Component({
  selector: 'app-alerts-settings',
  imports: [ToggleSwitch],
  templateUrl: './alerts-settings.html',
})
export class AlertsSettingsComponent {
  @Input() settings!: AppSettings;
  @Output() settingsChange = new EventEmitter<void>();

  onChange(): void {
    this.settingsChange.emit();
  }
}
