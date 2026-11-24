import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { AppSettings, DEFAULT_SETTINGS, SettingsPatch } from '../pages/settings-modal/settings.model';

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly state = signal<AppSettings>(DEFAULT_SETTINGS);
  readonly settings = this.state.asReadonly();

  private queue: Promise<unknown> = Promise.resolve();

  load(): Promise<AppSettings> {
    return this.enqueue(() => invoke<AppSettings>('load_settings'));
  }

  update(patch: SettingsPatch): Promise<AppSettings> {
    return this.enqueue(() => invoke<AppSettings>('update_settings', { patch }));
  }

  private enqueue(request: () => Promise<AppSettings>): Promise<AppSettings> {
    const run = this.queue.then(async () => {
      const settings = await request();
      this.state.set(settings);
      return settings;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
