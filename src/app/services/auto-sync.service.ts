import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { AppSettings } from '../pages/settings-modal/settings.model';

interface AutoSyncConfig {
  enabled: boolean;
  intervalMins: number;
  smart: boolean;
}

@Injectable({ providedIn: 'root' })
export class AutoSyncService {
  private applied: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  apply(settings: AppSettings, loggedIn: boolean, launchOnFirstSync = true): Promise<void> {
    const config: AutoSyncConfig = {
      enabled: settings.autoImportEnabled && loggedIn,
      intervalMins: settings.autoImportInterval,
      smart: settings.smartSyncEnabled && loggedIn,
    };
    const run = this.queue.then(() => this.configure(config, launchOnFirstSync));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async configure(config: AutoSyncConfig, launchOnFirstSync: boolean): Promise<void> {
    const key = JSON.stringify(config);
    if (key === this.applied) return;

    await invoke('configure_auto_sync', { ...config, launchOnFirstSync });
    this.applied = key;
  }
}
