import { Component } from '@angular/core';
import { Update } from '@tauri-apps/plugin-updater';
import { UpdateService } from '../../services/update.service';
import { ToastService } from '../../services/toast.service';
import { TooltipDirective } from '../../directives/tooltip.directive';

@Component({
  selector: 'app-update-button',
  imports: [TooltipDirective],
  templateUrl: './update-button.html',
  styleUrl: './update-button.css',
})
export class UpdateButton {
  isInstalling = false;

  constructor(
    private updateService: UpdateService,
    private toastService: ToastService
  ) {}

  get update(): Update | null {
    return this.updateService.available();
  }

  async onClick(): Promise<void> {
    const update = this.update;
    if (!update || this.isInstalling) return;

    this.isInstalling = true;

    try {
      await this.updateService.downloadAndInstall(update);
      await this.updateService.relaunch();
    } catch (error) {
      console.error('Erro ao baixar/instalar atualização:', error);
      this.toastService.error('Não foi possível baixar a atualização');
      this.isInstalling = false;
    }
  }
}
