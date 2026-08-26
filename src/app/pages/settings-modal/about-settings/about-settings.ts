import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Update } from '@tauri-apps/plugin-updater';
import { UpdateService } from '../../../services/update.service';
import { ToastService } from '../../../services/toast.service';
import { AppSettings } from '../settings.model';

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

  private lastResult: 'up-to-date' | 'available' | 'ready' | null = null;

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
    return this.settings?.lastUpdateResult === 'available';
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
    }

    switch (this.settings?.lastUpdateResult) {
      case 'up-to-date':
        return 'Atualizado';
      case 'available':
        return this.availableLabel;
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

    if (await this.resolvePendingUpdate()) {
      this.updateState = 'available';
    }
  }

  private async resolvePendingUpdate(): Promise<Update | null> {
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
      } else {
        this.updateState = 'up-to-date';
        this.lastResult = 'up-to-date';
      }

      return update;
    } catch (error) {
      console.error('Erro ao verificar atualizações:', error);
      this.toastService.error('Erro ao verificar atualizações');
      this.updateState = 'idle';
      return null;
    }
  }

  async onInstallUpdate() {
    if (this.updateState === 'downloading' || this.updateState === 'ready') {
      return;
    }

    const update = this.pendingUpdate ?? await this.resolvePendingUpdate();
    if (!update) {
      return;
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
    } catch (error) {
      console.error('Erro ao baixar/instalar atualização:', error);
      this.toastService.error('Erro ao baixar atualização');
      this.updateState = 'available';
    }
  }

  async onRelaunch() {
    await this.updateService.relaunch();
  }
}
