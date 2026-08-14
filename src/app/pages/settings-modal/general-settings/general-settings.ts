import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToggleSwitch } from '../../../components/toggle-switch/toggle-switch';
import { CustomSelect, SelectOption } from '../../../components/custom-select/custom-select';

export interface GeneralSettings {
  autoImportEnabled: boolean;
  autoImportInterval: number;
  importOnStartupEnabled: boolean;
  alarmEnabled: boolean;
  notificationEnabled: boolean;
  autostartEnabled: boolean;
}

@Component({
  selector: 'app-general-settings',
  imports: [CommonModule, ToggleSwitch, CustomSelect],
  templateUrl: './general-settings.html',
  styleUrl: './general-settings.css',
})
export class GeneralSettingsComponent {
  @Input() settings!: GeneralSettings;
  @Input() intervalOptions: SelectOption[] = [];
  @Output() settingsChange = new EventEmitter<void>();

  onToggleChange(): void {
    this.settingsChange.emit();
  }

  onIntervalChange(): void {
    this.settingsChange.emit();
  }
}
