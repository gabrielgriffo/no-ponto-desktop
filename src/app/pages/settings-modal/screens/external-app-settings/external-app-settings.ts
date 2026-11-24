import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { ToggleSwitch } from '../../../../components/toggle-switch/toggle-switch';
import { ToastService } from '../../../../services/toast.service';
import { SettingsStore } from '../../../../services/settings.store';
import { TooltipDirective } from '../../../../directives/tooltip.directive';
import { AppSettings, ExternalApp, SettingsPatch } from '../../settings.model';

@Component({
  selector: 'app-external-app-settings',
  imports: [ToggleSwitch, TooltipDirective],
  templateUrl: './external-app-settings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExternalAppSettingsComponent {
  private readonly toastService = inject(ToastService);
  private readonly store = inject(SettingsStore);

  readonly settings = input.required<AppSettings>();
  readonly patch = output<SettingsPatch>();

  protected readonly isPickingApp = signal(false);
  protected readonly isTestingApp = signal(false);

  protected async onPickExternalApp(): Promise<void> {
    // O diálogo nativo é modal só em relação à janela: sem essa trava, cliques
    // repetidos no botão empilhariam seletores.
    if (this.isPickingApp()) return;
    this.isPickingApp.set(true);

    try {
      const app = await invoke<ExternalApp | null>('pick_external_app');

      // null = usuário cancelou; a seleção anterior continua valendo
      if (app) await this.store.load();
    } catch (error) {
      console.error('Erro ao selecionar aplicativo:', error);
      // O Rust já devolve mensagens prontas para o usuário
      this.toastService.error(typeof error === 'string' ? error : 'Não foi possível selecionar o aplicativo');
    } finally {
      this.isPickingApp.set(false);
    }
  }

  protected async onTestExternalApp(): Promise<void> {
    const app = this.settings().externalApp;
    if (!app || this.isTestingApp()) return;
    this.isTestingApp.set(true);

    try {
      await invoke('external_app_test_launch');
      this.toastService.success(`${app.name} foi iniciado`);
    } catch (error) {
      console.error('Erro ao testar aplicativo:', error);
      this.toastService.error(typeof error === 'string' ? error : 'Não foi possível iniciar o aplicativo');
    } finally {
      this.isTestingApp.set(false);
    }
  }
}
