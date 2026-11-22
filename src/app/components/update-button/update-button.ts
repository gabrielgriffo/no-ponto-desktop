import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { UpdateService } from '../../services/update.service';
import { ToastService } from '../../services/toast.service';
import { TooltipDirective } from '../../directives/tooltip.directive';

@Component({
  selector: 'app-update-button',
  imports: [TooltipDirective],
  templateUrl: './update-button.html',
  styleUrl: './update-button.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpdateButton {
  private readonly updateService = inject(UpdateService);
  private readonly toastService = inject(ToastService);

  protected readonly update = this.updateService.available;
  protected readonly isInstalling = this.updateService.installing;

  protected async onClick(): Promise<void> {
    const update = this.update();
    if (!update || this.isInstalling()) return;

    try {
      await this.updateService.downloadAndInstall(update);
      await this.updateService.relaunch();
    } catch (error) {
      console.error('Erro ao baixar/instalar atualização:', error);
      this.toastService.error('Não foi possível baixar a atualização');
    }
  }
}
