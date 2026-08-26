import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-settings-group',
  templateUrl: './settings-group.html',
  styleUrl: './settings-group.css',
})
export class SettingsGroup {
  @Input() label = '';
}
