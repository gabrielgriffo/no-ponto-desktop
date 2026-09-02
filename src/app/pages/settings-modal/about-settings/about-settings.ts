import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Update } from '@tauri-apps/plugin-updater';
import { UpdateService } from '../../../services/update.service';
import { ToastService } from '../../../services/toast.service';
import { AppSettings, isNewerVersion } from '../settings.model';

export interface AppInfo {
  version: string;
  product_name: string;
  tauri_version: string;
  architecture: string;
  os_platform: string;
  build_type: string;
}

type UpdateState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready';

@Component({
  selector: 'app-about-settings',
  imports: [CommonModule],
  templateUrl: './about-settings.html',
  styleUrl: './about-settings.css',
})
export class AboutSettingsComponent {
  @Input() appInfo!: AppInfo;
  @Input() settings!: AppSettings;

  @Output() settingsChange = new EventEmitter<void>();

  updateState: UpdateState = 'idle';
  downloadProgress = 0;
  pendingUpdate: Update | null = null;

  private lastResult: 'up-to-date' | 'available' | 'ready' | 'error' | null = null;

  private get isWindows(): boolean {
    return (this.appInfo?.os_platform ?? '').toLowerCase().startsWith('windows');
  }

  get isUpdateBusy(): boolean {
    return this.updateState === 'checking'
      || this.updateState === 'downloading'
      || this.updateState === 'ready';
  }

  get lastCheckLabel(): string {
    const raw = this.settings?.lastUpdateCheck;
    if (!raw) return 'Nunca';

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'Nunca';

    const pad = (n: number) => String(n).padStart(2, '0');
    const dia = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    return `${dia} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  get canInstall(): boolean {
    return this.updateState !== 'ready' && this.isUpdateAvailable;
  }

  get isUpdateAvailable(): boolean {
    if (this.lastResult) {
      return this.lastResult === 'available';
    }
    return this.hasCachedUpdate;
  }

  private get hasCachedUpdate(): boolean {
    return this.settings?.lastUpdateResult === 'available'
      && isNewerVersion(this.settings.lastUpdateVersion, this.appInfo?.version ?? '');
  }

  private get availableLabel(): string {
    const version = this.pendingUpdate?.version || this.settings?.lastUpdateVersion;
    return version ? `Versão ${version} disponível` : 'Atualização disponível';
  }

  get statusLabel(): string {
    switch (this.lastResult) {
      case 'up-to-date':
        return 'Atualizado';
      case 'available':
        return this.availableLabel;
      case 'ready':
        return 'Pronto para reiniciar';
      case 'error':
        return 'Falha na verificação';
    }

    if (this.hasCachedUpdate) {
      return this.availableLabel;
    }

    switch (this.settings?.lastUpdateResult) {
      case 'up-to-date':
      case 'available':
        return 'Atualizado';
      case 'error':
        return 'Falha na verificação';
      default:
        return 'Não verificado';
    }
  }

  constructor(
    private updateService: UpdateService,
    private toastService: ToastService
  ) {}

  async onCheckForUpdate() {
    if (this.isUpdateBusy) return;

    if (await this.resolvePendingUpdate(true)) {
      this.updateState = 'available';
    }
  }

  private async resolvePendingUpdate(notify: boolean): Promise<Update | null> {
    this.updateState = 'checking';

    try {
      const update = await this.updateService.checkForUpdate();

      this.settings.lastUpdateCheck = new Date().toISOString();
      this.settings.lastUpdateResult = update ? 'available' : 'up-to-date';
      this.settings.lastUpdateVersion = update?.version ?? '';
      this.settingsChange.emit();

      if (update) {
        this.pendingUpdate = update;
        this.lastResult = 'available';
        if (notify) {
          this.toastService.info(`Versão ${update.version} disponível`);
        }
      } else {
        this.updateState = 'up-to-date';
        this.lastResult = 'up-to-date';
        if (notify) {
          this.toastService.success('Você já está na versão mais recente');
        }
      }

      return update;
    } catch (error) {
      console.error('Erro ao verificar atualizações:', error);

      this.settings.lastUpdateCheck = new Date().toISOString();
      this.settings.lastUpdateResult = 'error';
      this.settings.lastUpdateVersion = '';
      this.settingsChange.emit();

      this.pendingUpdate = null;
      this.lastResult = 'error';
      this.toastService.error('Não foi possível verificar atualizações');
      this.updateState = 'idle';
      return null;
    }
  }

  async onInstallUpdate() {
    if (this.updateState === 'downloading' || this.updateState === 'ready') {
      return;
    }

    const update = this.pendingUpdate ?? await this.resolvePendingUpdate(false);
    if (!update) {
      return;
    }

    if (this.isWindows) {
      this.toastService.info('O app será fechado para instalar a atualização');
    }

    this.updateState = 'downloading';
    this.downloadProgress = 0;

    try {
      await this.updateService.downloadAndInstall(update, (progress) => {
        if (progress.contentLength) {
          this.downloadProgress = Math.round((progress.downloaded / progress.contentLength) * 100);
        }
      });

      this.updateState = 'ready';
      this.lastResult = 'ready';
      this.toastService.success('Atualização instalada, reinicie para aplicar');
    } catch (error) {
      console.error('Erro ao baixar/instalar atualização:', error);
      this.toastService.error('Não foi possível baixar a atualização');
      this.updateState = 'available';
    }
  }

  async onRelaunch() {
    await this.updateService.relaunch();
  }
}
