import { Injectable } from '@angular/core';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';

@Injectable({ providedIn: 'root' })
export class AutostartService {
  enable(): Promise<void> {
    return enable();
  }

  isEnabled(): Promise<boolean> {
    return isEnabled();
  }

  disable(): Promise<void> {
    return disable();
  }
}
