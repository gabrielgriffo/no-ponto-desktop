import { Injectable, inject } from '@angular/core';
import { ToastService } from './toast.service';
import { PontoMaisService } from './pontomais.service';
import { AutostartService } from './autostart.service';
import { SettingsStore } from './settings.store';
import { AutoSyncService } from './auto-sync.service';
import { ALARM_SOUND_OPTIONS, DEFAULT_ALARM_SOUND, SettingsPatch } from '../pages/settings-modal/settings.model';

@Injectable({ providedIn: 'root' })
export class SettingsActionsService {
  private readonly toastService = inject(ToastService);
  private readonly pontoMaisService = inject(PontoMaisService);
  private readonly autostartService = inject(AutostartService);
  private readonly store = inject(SettingsStore);
  private readonly autoSync = inject(AutoSyncService);

  readonly settings = this.store.settings;

  async loadAndReconcile(): Promise<void> {
    const loaded = await this.store.load();
    const reconcile: SettingsPatch = {};

    if (!ALARM_SOUND_OPTIONS.some(option => option.value === loaded.alarmSound)) {
      reconcile.alarmSound = DEFAULT_ALARM_SOUND;
    }

    try {
      const autostart = await this.autostartService.isEnabled();
      if (autostart !== loaded.autostartEnabled) reconcile.autostartEnabled = autostart;
    } catch (error) {
      console.error('Erro ao consultar a inicialização com o sistema:', error);
    }

    try {
      const connected = (await this.pontoMaisService.ensureSession()) === 'connected';
      if (connected !== loaded.isPontomaisLoggedIn) reconcile.isPontomaisLoggedIn = connected;
    } catch (error) {
      console.error('Erro ao restaurar sessão:', error);
    }

    if (Object.keys(reconcile).length) {
      await this.persist(reconcile);
    }
  }

  async applyPatch(patch: SettingsPatch): Promise<boolean> {
    if (patch.autostartEnabled !== undefined) {
      patch = { ...patch, autostartEnabled: await this.syncAutostart(patch.autostartEnabled) };
    }
    return this.persist(patch);
  }

  async authenticate(login: string, password: string): Promise<boolean> {
    if (!login || !password) {
      this.toastService.error('Preencha login e senha', 3000);
      return false;
    }

    try {
      await this.pontoMaisService.authenticate({ username: login, password });
      await this.store.load();
      await this.applyAutoSync();
      return true;
    } catch (error) {
      console.error('Erro ao fazer login:', error);
      const message = typeof error === 'string' ? error : 'Erro ao fazer login. Verifique suas credenciais.';
      this.toastService.error(message);
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.pontoMaisService.clearSession();
    } catch (error) {
      console.error('Erro ao encerrar sessão no PontoMais:', error);
    }

    if (await this.persist({ isPontomaisLoggedIn: false })) {
      this.toastService.success('Conta desconectada');
    }
  }

  private async persist(patch: SettingsPatch): Promise<boolean> {
    try {
      await this.store.update(patch);
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
      this.toastService.error('Não foi possível salvar as configurações');
      return false;
    }

    await this.applyAutoSync();
    return true;
  }

  private async syncAutostart(wanted: boolean): Promise<boolean> {
    let current: boolean;
    try {
      current = await this.autostartService.isEnabled();
    } catch (error) {
      console.error('Erro ao consultar a inicialização com o sistema:', error);
      return wanted;
    }

    if (wanted === current) return current;

    try {
      if (wanted) {
        await this.autostartService.enable();
      } else {
        await this.autostartService.disable();
      }
      return wanted;
    } catch (error) {
      console.error('Erro ao alterar a inicialização com o sistema:', error);
      this.toastService.error('Não foi possível alterar a inicialização com o sistema');
      return current;
    }
  }

  private async applyAutoSync(): Promise<void> {
    try {
      await this.autoSync.apply(this.settings(), this.settings().isPontomaisLoggedIn, false);
    } catch (error) {
      console.error('Erro ao configurar a sincronização:', error);
    }
  }
}
