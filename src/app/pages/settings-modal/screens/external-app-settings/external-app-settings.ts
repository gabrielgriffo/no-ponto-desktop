import { Component, Input, Output, EventEmitter } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { ToggleSwitch } from '../../../../components/toggle-switch/toggle-switch';
import { ToastService } from '../../../../services/toast.service';
import { TooltipDirective } from '../../../../directives/tooltip.directive';
import { AppSettings, ExternalApp } from '../../settings.model';

@Component({
  selector: 'app-external-app-settings',
  imports: [ToggleSwitch, TooltipDirective],
  templateUrl: './external-app-settings.html',
})
export class ExternalAppSettingsComponent {
  @Input() settings!: AppSettings;
  @Output() settingsChange = new EventEmitter<void>();

  isPickingApp = false;
  isTestingApp = false;

  constructor(private toastService: ToastService) {}

  onChange(): void {
    this.settingsChange.emit();
  }

  async onPickExternalApp(): Promise<void> {
    // O diálogo nativo é modal só em relação à janela: sem essa trava, cliques
    // repetidos no botão empilhariam seletores.
    if (this.isPickingApp) return;
    this.isPickingApp = true;

    try {
      const app = await invoke<ExternalApp | null>('pick_external_app');

      // null = usuário cancelou; a seleção anterior continua valendo
      if (app) {
        this.settings.externalApp = app;
        this.settingsChange.emit();
      }
    } catch (error) {
      console.error('Erro ao selecionar aplicativo:', error);
      // O Rust já devolve mensagens prontas para o usuário
      this.toastService.error(
        typeof error === 'string' ? error : 'Não foi possível selecionar o aplicativo'
      );
    } finally {
      this.isPickingApp = false;
    }
  }

  async onTestExternalApp(): Promise<void> {
    const app = this.settings.externalApp;
    if (!app || this.isTestingApp) return;
    this.isTestingApp = true;

    try {
      await invoke('external_app_test_launch', { target: app });
      this.toastService.success(`${app.name} foi iniciado`);
    } catch (error) {
      console.error('Erro ao testar aplicativo:', error);
      this.toastService.error(
        typeof error === 'string' ? error : 'Não foi possível iniciar o aplicativo'
      );
    } finally {
      this.isTestingApp = false;
    }
  }
}
