import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Tabs } from '../../components/tabs/tabs';
import { GeneralSettingsComponent } from './general-settings/general-settings';
import { IntegrationSettingsComponent } from './integration-settings/integration-settings';
import { AboutSettingsComponent } from './about-settings/about-settings';
import { invoke } from '@tauri-apps/api/core';
import { ToastService } from '../../services/toast.service';
import { PontoMaisService } from '../../services/pontomais.service';
import { CredentialsService } from '../../services/credentials.service';
import { AutostartService } from '../../services/autostart.service';

interface Settings {
  autoImportEnabled: boolean;
  autoImportInterval: number;
  importOnStartupEnabled: boolean;
  alarmEnabled: boolean;
  notificationEnabled: boolean;
  autostartEnabled: boolean;
  pontomaisLogin: string;
  isPontomaisLoggedIn: boolean;
}

interface AppInfo {
  version: string;
  product_name: string;
  tauri_version: string;
  architecture: string;
  os_platform: string;
  build_type: string;
}

@Component({
  selector: 'app-settings-modal',
  imports: [CommonModule, Tabs, GeneralSettingsComponent, IntegrationSettingsComponent, AboutSettingsComponent],
  templateUrl: './settings-modal.html',
  styleUrl: './settings-modal.css',
})
export class SettingsModal implements OnInit, OnChanges {
  @Input() isOpen: boolean = false;
  @Output() close = new EventEmitter<void>();
  @ViewChild('modalContainer') modalContainer?: ElementRef<HTMLDivElement>;

  activeTabIndex: number = 0;
  tabLabels: string[] = ['Geral', 'Integração', 'Sobre'];

  appInfo: AppInfo = {
    version: '',
    product_name: '',
    tauri_version: '',
    architecture: '',
    os_platform: '',
    build_type: ''
  };

  settings: Settings = {
    autoImportEnabled: false,
    autoImportInterval: 10,
    importOnStartupEnabled: false,
    alarmEnabled: false,
    notificationEnabled: false,
    autostartEnabled: false,
    pontomaisLogin: '',
    isPontomaisLoggedIn: false
  };

  integrationSettings = {
    pontomaisLogin: '',
    pontomaisPassword: '',
    isLoggedIn: false
  };

  isLoggingIn = false;
  settingsLoaded = false;

  intervalOptions = [
    { value: 10, label: '10 minutos' },
    { value: 15, label: '15 minutos' },
    { value: 30, label: '30 minutos' },
    { value: 60, label: '1 hora' }
  ];

  constructor(
    private toastService: ToastService,
    private pontoMaisService: PontoMaisService,
    private credentialsService: CredentialsService,
    private autostartService: AutostartService
  ) {}

  async ngOnInit() {
    await this.loadAppInfo();
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (changes['isOpen'] && changes['isOpen'].currentValue === true) {
      this.activeTabIndex = 0;
      this.settingsLoaded = false;

      // Carregar settings ao abrir o modal
      await this.loadSettings();
      this.settingsLoaded = true;

      // Remover foco do botão de fechar ao abrir o modal
      setTimeout(() => {
        this.modalContainer?.nativeElement.focus();
      }, 0);
    }
  }

  async loadSettings() {
    try {
      const loadedSettings = await invoke<Settings>('load_settings');
      this.settings = loadedSettings;

      // Verificar o status REAL do autostart no sistema
      const actualAutostartStatus = await this.autostartService.isEnabled();

      // Se o status real for diferente do salvo, sincronizar
      if (actualAutostartStatus !== this.settings.autostartEnabled) {
        this.settings.autostartEnabled = actualAutostartStatus;
        await this.saveSettings();
      }

      // SEMPRE verificar o keyring do SO como fonte da verdade
      const token = await this.credentialsService.getToken();

      if (token) {
        // Token existe no keyring
        try {
          // Restaurar sessão no backend Rust
          await this.pontoMaisService.restoreSession(
            token.token,
            token.client_id,
            token.expiry,
            token.uid
          );

          // Atualizar TODOS os estados como logado
          this.integrationSettings.isLoggedIn = true;
          this.settings.isPontomaisLoggedIn = true;

          // Se o settings.json não tinha o login salvo, atualizar
          if (!loadedSettings.isPontomaisLoggedIn) {
            await this.saveSettings();
          }
        } catch (error) {
          console.error('Erro ao restaurar sessão no modal:', error);
          // Se falhar ao restaurar, marcar como não logado
          this.integrationSettings.isLoggedIn = false;
          this.settings.isPontomaisLoggedIn = false;
          await this.saveSettings();
        }
      } else {
        // Token não existe no keyring
        this.integrationSettings.isLoggedIn = false;
        this.settings.isPontomaisLoggedIn = false;

        // Se o settings.json tinha marcado como logado, corrigir
        if (loadedSettings.isPontomaisLoggedIn) {
          await this.saveSettings();
        }
      }

      // Atualizar dados de integração
      this.integrationSettings.pontomaisLogin = this.settings.pontomaisLogin;
      this.integrationSettings.pontomaisPassword = '';

    } catch (error) {
      console.error('Erro ao carregar configurações:', error);
    }
  }

  async loadAppInfo() {
    try {
      const info = await invoke<AppInfo>('get_app_info');
      this.appInfo = info;
    } catch (error) {
      console.error('Erro ao carregar informações do app:', error);
    }
  }

  async saveSettings() {
    try {
      // Sincronizar autostart com o sistema operacional
      const currentAutostartStatus = await this.autostartService.isEnabled();

      if (this.settings.autostartEnabled && !currentAutostartStatus) {
        // Usuário quer habilitar e não está habilitado
        await this.autostartService.enable();
      } else if (!this.settings.autostartEnabled && currentAutostartStatus) {
        // Usuário quer desabilitar e está habilitado
        await this.autostartService.disable();
      }

      await invoke('save_settings', { settings: this.settings });

      // Reconfigura o timer de sincronização automática conforme as novas configurações
      await invoke('configure_auto_sync', {
        enabled: this.settings.autoImportEnabled && this.settings.isPontomaisLoggedIn,
        intervalMins: this.settings.autoImportInterval
      });
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
    }
  }

  async onSaveCredentials() {
    if (!this.integrationSettings.pontomaisLogin || !this.integrationSettings.pontomaisPassword) {
      this.toastService.error('Preencha login e senha', 3000);
      return;
    }

    this.isLoggingIn = true;

    try {
      // Tentar autenticar
      const authResponse = await this.pontoMaisService.authenticate({
        username: this.integrationSettings.pontomaisLogin,
        password: this.integrationSettings.pontomaisPassword
      });

      // Salvar token no keyring do SO
      await this.credentialsService.saveToken({
        token: authResponse.token,
        client_id: authResponse.client_id,
        expiry: authResponse.expiry,
        uid: authResponse.uid
      });

      // Atualizar settings
      this.settings.pontomaisLogin = this.integrationSettings.pontomaisLogin;
      this.settings.isPontomaisLoggedIn = true;

      // LIMPAR senha da memória
      this.integrationSettings.pontomaisPassword = '';

      // Atualizar UI
      this.integrationSettings.isLoggedIn = true;

      // Salvar settings
      await this.saveSettings();

      this.toastService.success('Login efetuado com sucesso!');
    } catch (error) {
      console.error('Erro ao fazer login:', error);
      const message = typeof error === 'string' ? error : 'Erro ao fazer login. Verifique suas credenciais.';
      this.toastService.error(message);
    } finally {
      this.isLoggingIn = false;
    }
  }

  async onLogout() {
    try {
      // Remover token do keyring do SO
      await this.credentialsService.deleteToken();

      // Atualizar settings
      this.settings.isPontomaisLoggedIn = false;
      this.integrationSettings.isLoggedIn = false;
      this.integrationSettings.pontomaisPassword = '';

      // Salvar settings
      await this.saveSettings();

      this.toastService.success('Logout efetuado com sucesso!');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
      this.toastService.error('Erro ao fazer logout');
    }
  }

  onClose() {
    this.close.emit();
  }

  onOverlayClick(event: MouseEvent) {
    // Fecha o modal apenas se clicar no overlay, não no conteúdo
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }
}
