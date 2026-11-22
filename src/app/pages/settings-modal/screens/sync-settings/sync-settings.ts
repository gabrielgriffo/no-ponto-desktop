import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ToggleSwitch } from '../../../../components/toggle-switch/toggle-switch';
import { CustomSelect } from '../../../../components/custom-select/custom-select';
import { AppSettings, INTERVAL_OPTIONS, SettingsPatch } from '../../settings.model';

@Component({
  selector: 'app-sync-settings',
  imports: [ToggleSwitch, CustomSelect],
  templateUrl: './sync-settings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SyncSettingsComponent {
  readonly settings = input.required<AppSettings>();
  readonly patch = output<SettingsPatch>();

  protected readonly intervalOptions = INTERVAL_OPTIONS;

  protected onAutoSyncToggle(enabled: boolean): void {
    this.patch.emit(enabled ? { autoImportEnabled: true, smartSyncEnabled: false } : { autoImportEnabled: false });
  }

  protected onSmartSyncToggle(enabled: boolean): void {
    this.patch.emit(enabled ? { smartSyncEnabled: true, autoImportEnabled: false } : { smartSyncEnabled: false });
  }
}
