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

  onAutoSyncToggle(enabled: boolean): void {
    this.settings.autoImportEnabled = enabled;
    if (enabled) this.settings.smartSyncEnabled = false;
    this.onChange();
  }

  onSmartSyncToggle(enabled: boolean): void {
    this.settings.smartSyncEnabled = enabled;
    if (enabled) this.settings.autoImportEnabled = false;
    this.onChange();
  }
}
