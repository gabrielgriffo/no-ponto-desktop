import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ToggleSwitch } from '../../../../components/toggle-switch/toggle-switch';
import { CustomSelect } from '../../../../components/custom-select/custom-select';
import { AppSettings, AUTO_CLOSE_TIME_OPTIONS, SettingsPatch } from '../../settings.model';

@Component({
  selector: 'app-startup-settings',
  imports: [ToggleSwitch, CustomSelect],
  templateUrl: './startup-settings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StartupSettingsComponent {
  readonly settings = input.required<AppSettings>();
  readonly patch = output<SettingsPatch>();

  protected readonly autoCloseTimeOptions = AUTO_CLOSE_TIME_OPTIONS;
}
