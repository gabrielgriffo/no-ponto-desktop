import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Update } from '@tauri-apps/plugin-updater';
import { UpdateService } from '../../../services/update.service';
import { ToastService } from '../../../services/toast.service';

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

  updateState: UpdateState = 'idle';
  downloadProgress = 0;
  pendingUpdate: Update | null = null;

  constructor(
    private updateService: UpdateService,
    private toastService: ToastService
  ) {}

  async onCheckForUpdate() {
    this.updateState = 'checking';

    try {
      const update = await this.updateService.checkForUpdate();

      if (update) {
        this.pendingUpdate = update;
        this.updateState = 'available';
      } else {
        this.updateState = 'up-to-date';
      }
    } catch (error) {
      console.error('Erro ao verificar atualizações:', error);
      this.toastService.error('Erro ao verificar atualizações');
      this.updateState = 'idle';
    }
  }

  async onInstallUpdate() {
    if (!this.pendingUpdate) {
      return;
    }

    this.updateState = 'downloading';
    this.downloadProgress = 0;

    try {
      await this.updateService.downloadAndInstall(this.pendingUpdate, (progress) => {
        if (progress.contentLength) {
          this.downloadProgress = Math.round((progress.downloaded / progress.contentLength) * 100);
        }
      });

      this.updateState = 'ready';
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
