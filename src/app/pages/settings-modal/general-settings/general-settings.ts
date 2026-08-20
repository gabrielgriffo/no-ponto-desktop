import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { invoke } from '@tauri-apps/api/core';
import { ToggleSwitch } from '../../../components/toggle-switch/toggle-switch';
import { CustomSelect, SelectOption } from '../../../components/custom-select/custom-select';
import { ToastService } from '../../../services/toast.service';

/// Espelha a struct `ExternalApp` do Rust (`src-tauri/src/external_app.rs`).
export interface ExternalApp {
  path: string;
  name: string;
  exec: string;
  args: string[];
}

export interface GeneralSettings {
  smartSyncEnabled: boolean;
  autoImportEnabled: boolean;
  autoImportInterval: number;
  importOnStartupEnabled: boolean;
  alarmEnabled: boolean;
  notificationEnabled: boolean;
  autostartEnabled: boolean;
  externalAppAutostartEnabled: boolean;
  externalApp: ExternalApp | null;
}

@Component({
  selector: 'app-general-settings',
  imports: [CommonModule, ToggleSwitch, CustomSelect],
  templateUrl: './general-settings.html',
  styleUrl: './general-settings.css',
})
export class GeneralSettingsComponent {
  @Input() settings!: GeneralSettings;
  @Input() intervalOptions: SelectOption[] = [];
  @Output() settingsChange = new EventEmitter<void>();

  isPickingApp = false;

  constructor(private toastService: ToastService) {}

  onToggleChange(): void {
    this.settingsChange.emit();
  }

  onIntervalChange(): void {
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
}
