import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { AppSettings, DEFAULT_SETTINGS, SettingsPatch } from '../pages/settings-modal/settings.model';

/**
 * Dono único das configurações no frontend. Toda alteração vai ao Rust como patch
 * parcial (`update_settings`), que faz o merge sob trava: quem grava um campo não
 * desfaz o que outro gravou em outro campo.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly state = signal<AppSettings>(DEFAULT_SETTINGS);
  readonly settings = this.state.asReadonly();

  async load(): Promise<AppSettings> {
    const settings = await invoke<AppSettings>('load_settings');
    this.state.set(settings);
    return settings;
  }

  async update(patch: SettingsPatch): Promise<AppSettings> {
    const settings = await invoke<AppSettings>('update_settings', { patch });
    this.state.set(settings);
    return settings;
  }
}
