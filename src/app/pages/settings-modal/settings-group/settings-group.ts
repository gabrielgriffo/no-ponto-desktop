import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-settings-group',
  templateUrl: './settings-group.html',
  styleUrl: './settings-group.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsGroup {
  readonly label = input('');
}
