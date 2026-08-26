import { Component, Input, Output, EventEmitter } from '@angular/core';
import { ToggleSwitch } from '../../../../components/toggle-switch/toggle-switch';
import { CustomSelect } from '../../../../components/custom-select/custom-select';
import { AppSettings, INTERVAL_OPTIONS } from '../../settings.model';

@Component({
  selector: 'app-sync-settings',
  imports: [ToggleSwitch, CustomSelect],
  templateUrl: './sync-settings.html',
})
export class SyncSettingsComponent {
  @Input() settings!: AppSettings;
  @Output() settingsChange = new EventEmitter<void>();

  readonly intervalOptions = INTERVAL_OPTIONS;

  onChange(): void {
    this.settingsChange.emit();
  }
}
