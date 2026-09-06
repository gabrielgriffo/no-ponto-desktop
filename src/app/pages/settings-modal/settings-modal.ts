import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges, ViewChild, ElementRef, HostListener } from '@angular/core';
import { SettingsRow } from './settings-row/settings-row';
import { SettingsGroup } from './settings-group/settings-group';
import { IntegrationSettingsComponent } from './integration-settings/integration-settings';
import { AboutSettingsComponent, AppInfo } from './about-settings/about-settings';
import { SyncSettingsComponent } from './screens/sync-settings/sync-settings';
import { WorkdaySettingsComponent } from './screens/workday-settings/workday-settings';
import { AlertsSettingsComponent } from './screens/alerts-settings/alerts-settings';
import { StartupSettingsComponent } from './screens/startup-settings/startup-settings';
import { ExternalAppSettingsComponent } from './screens/external-app-settings/external-app-settings';
import { invoke } from '@tauri-apps/api/core';
import { ToastService } from '../../services/toast.service';
import { PontoMaisService } from '../../services/pontomais.service';
import { AutostartService } from '../../services/autostart.service';
import {
  AppSettings,
  DEFAULT_ALARM_DURATION_SECONDS,
  DEFAULT_ALARM_MODE,
  DEFAULT_ALARM_SOUND,
  DEFAULT_ALARM_VOLUME,
  DEFAULT_AUTO_CLOSE_TIME,
  DEFAULT_BREAK_MINUTES,
  DEFAULT_EXPECTED_WORKDAY_MINUTES,
  INTERVAL_OPTIONS,
  formatWorkday,
  isNewerVersion,
} from './settings.model';

type ScreenId =
  | 'conta'
  | 'sincronizacao'
  | 'expediente'
  | 'avisos'
  | 'inicializacao'
  | 'app-externo'
  | 'sobre';

const SCREEN_TITLES: Record<ScreenId, string> = {
  'conta': 'Conta',
  'sincronizacao': 'Sincronização',
  'expediente': 'Expediente',
  'avisos': 'Alarme e notificações',
  'inicializacao': 'Inicialização',
  'app-externo': 'Aplicativo externo',
  'sobre': 'Sobre',
};

@Component({
  selector: 'app-settings-modal',
  imports: [
    SettingsRow,
    SettingsGroup,
    IntegrationSettingsComponent,
    AboutSettingsComponent,
    SyncSettingsComponent,
    WorkdaySettingsComponent,
    AlertsSettingsComponent,
    StartupSettingsComponent,
    ExternalAppSettingsComponent,
  ],
  templateUrl: './settings-modal.html',
  styleUrl: './settings-modal.css',
})
export class SettingsModal implements OnInit, OnChanges {
  @Input() isOpen: boolean = false;
  @Output() close = new EventEmitter<void>();
  @ViewChild('modalContainer') modalContainer?: ElementRef<HTMLDivElement>;

  screenStack: ScreenId[] = [];

  appInfo: AppInfo = {
    version: '',
    product_name: '',
    tauri_version: '',
    architecture: '',
    os_platform: '',
    build_type: ''
  };

  settings: AppSettings = {
    smartSyncEnabled: false,
    autoImportEnabled: false,
    autoImportInterval: 10,
    importOnStartupEnabled: false,
    alarmEnabled: false,
    alarmSound: DEFAULT_ALARM_SOUND,
    alarmVolume: DEFAULT_ALARM_VOLUME,
    alarmMode: DEFAULT_ALARM_MODE,
    alarmDurationSeconds: DEFAULT_ALARM_DURATION_SECONDS,
    notificationEnabled: false,
    autostartEnabled: false,
    startMinimizedEnabled: false,
    autoCloseWithoutWorkdayEnabled: false,
    autoCloseWithoutWorkdayTime: DEFAULT_AUTO_CLOSE_TIME,
    externalAppAutostartEnabled: false,
    externalApp: null,
    expectedWorkdayMinutes: DEFAULT_EXPECTED_WORKDAY_MINUTES,
    defaultBreakMinutes: DEFAULT_BREAK_MINUTES,
    lastUpdateCheck: '',
    lastUpdateResult: '',
    lastUpdateVersion: '',
    pontomaisLogin: '',
    isPontomaisLoggedIn: false,
    autoReconnectEnabled: false
  };

  integrationSettings = {
    pontomaisLogin: '',
    pontomaisPassword: '',
    isLoggedIn: false
  };

  isLoggingIn = false;
  settingsLoaded = false;

  constructor(
    private toastService: ToastService,
    private pontoMaisService: PontoMaisService,
    private autostartService: AutostartService
  ) {}

  get currentScreen(): ScreenId | null {
    return this.screenStack.length ? this.screenStack[this.screenStack.length - 1] : null;
  }

  get title(): string {
    const screen = this.currentScreen;
    return screen ? SCREEN_TITLES[screen] : 'Configurações';
  }

  get accountValue(): string {
    if (!this.settings.isPontomaisLoggedIn) return 'Não conectada';
    return this.settings.pontomaisLogin || 'Conectada';
  }

  get syncValue(): string {
    if (!this.settings.autoImportEnabled) return '';
    const option = INTERVAL_OPTIONS.find(opt => opt.value === this.settings.autoImportInterval);
    return option?.label ?? `${this.settings.autoImportInterval} minutos`;
  }

  get hasUpdate(): boolean {
    return this.settings.lastUpdateResult === 'available'
      && isNewerVersion(this.settings.lastUpdateVersion, this.appInfo.version);
  }

  get workdayValue(): string {
    return formatWorkday(this.settings.expectedWorkdayMinutes);
  }

  get externalAppValue(): string {
    if (!this.settings.externalAppAutostartEnabled) return '';
    return this.settings.externalApp?.name ?? '';
  }

  openScreen(screen: ScreenId): void {
    this.screenStack.push(screen);
  }

  goBack(): void {
    this.screenStack.pop();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.isOpen) return;

    if (this.screenStack.length) {
      this.goBack();
    } else {
      this.onClose();
    }
  }

  async ngOnInit() {
    await this.loadAppInfo();
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (changes['isOpen'] && changes['isOpen'].currentValue === true) {
      this.screenStack = [];
      this.settingsLoaded = false;

      await this.loadSettings();
      this.settingsLoaded = true;

      setTimeout(() => {
        this.modalContainer?.nativeElement.focus();
      }, 0);
    }
  }

  async loadSettings() {
    try {
      const loadedSettings = await invoke<AppSettings>('load_settings');
      this.settings = loadedSettings;

      const actualAutostartStatus = await this.autostartService.isEnabled();

      if (actualAutostartStatus !== this.settings.autostartEnabled) {
        this.settings.autostartEnabled = actualAutostartStatus;
        await this.saveSettings();
      }

      // O Rust diz se há conta vinculada; nem token nem senha passam por aqui.
      let connected: boolean;
      try {
        connected = (await this.pontoMaisService.ensureSession()) === 'connected';
      } catch (error) {
        console.error('Erro ao restaurar sessão no modal:', error);
        connected = false;
      }

      this.integrationSettings.isLoggedIn = connected;
      this.settings.isPontomaisLoggedIn = connected;

      if (loadedSettings.isPontomaisLoggedIn !== connected) {
        await this.saveSettings();
      }

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
      const currentAutostartStatus = await this.autostartService.isEnabled();

      if (this.settings.autostartEnabled && !currentAutostartStatus) {
        await this.autostartService.enable();
      } else if (!this.settings.autostartEnabled && currentAutostartStatus) {
        await this.autostartService.disable();
      }

      await invoke('save_settings', { settings: this.settings });

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
      // O Rust autentica, grava o token e — se a Reconexão Automática estiver ligada —
      // a senha. Aqui não sobra credencial nenhuma.
      await this.pontoMaisService.authenticate({
        username: this.integrationSettings.pontomaisLogin,
        password: this.integrationSettings.pontomaisPassword
      });

      this.settings.pontomaisLogin = this.integrationSettings.pontomaisLogin;
      this.settings.isPontomaisLoggedIn = true;

      this.integrationSettings.pontomaisPassword = '';

      this.integrationSettings.isLoggedIn = true;

      await this.saveSettings();

      // Sem toast de sucesso: a tela troca o formulário pela conta conectada,
      // o que já comunica o resultado.
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
      // Revoga o token na API, zera a sessão do Rust e apaga o cofre — tudo do lado
      // de lá. Isolado num try próprio: uma falha aqui não pode abortar o logout
      // local, senão a conta ficaria presa como conectada.
      try {
        await this.pontoMaisService.clearSession();
      } catch (error) {
        console.error('Erro ao encerrar sessão no PontoMais:', error);
      }

      this.settings.isPontomaisLoggedIn = false;
      this.integrationSettings.isLoggedIn = false;
      this.integrationSettings.pontomaisPassword = '';

      await this.saveSettings();

      this.toastService.success('Conta desconectada');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
      this.toastService.error('Erro ao desconectar a conta');
    }
  }

  onClose() {
    this.close.emit();
  }

  onOverlayClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }
}
