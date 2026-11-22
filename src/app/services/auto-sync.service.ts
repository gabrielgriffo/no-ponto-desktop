import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { AppSettings } from '../pages/settings-modal/settings.model';

interface AutoSyncConfig {
  enabled: boolean;
  intervalMins: number;
  smart: boolean;
}

/**
 * Dono do laço de sincronização no frontend. Guarda a última configuração aplicada
 * ao Rust: reconfigurar reinicia o laço, que busca na hora, então só se aplica o que
 * mudou. Sem conta conectada o laço fica desligado.
 */
@Injectable({ providedIn: 'root' })
export class AutoSyncService {
  private applied: string | null = null;

  async apply(settings: AppSettings, loggedIn: boolean): Promise<void> {
    const config: AutoSyncConfig = {
      enabled: settings.autoImportEnabled && loggedIn,
      intervalMins: settings.autoImportInterval,
      smart: settings.smartSyncEnabled && loggedIn,
    };
    const key = JSON.stringify(config);
    if (key === this.applied) return;

    await invoke('configure_auto_sync', { ...config });
    this.applied = key;
  }
}
