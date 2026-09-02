import { Component, Input, Output, EventEmitter } from '@angular/core';
import { ToggleSwitch } from '../../../../components/toggle-switch/toggle-switch';
import { CustomSelect } from '../../../../components/custom-select/custom-select';
import { AppSettings, AUTO_CLOSE_TIME_OPTIONS } from '../../settings.model';

@Component({
  selector: 'app-startup-settings',
  imports: [ToggleSwitch, CustomSelect],
  templateUrl: './startup-settings.html',
})
export class StartupSettingsComponent {
  @Input() settings!: AppSettings;
  @Output() settingsChange = new EventEmitter<void>();

  readonly autoCloseTimeOptions = AUTO_CLOSE_TIME_OPTIONS;

  onChange(): void {
    this.settingsChange.emit();
  }
}
