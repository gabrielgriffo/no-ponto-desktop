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
  ALARM_SOUND_OPTIONS,
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

const EXTERNAL_FIELDS = ['isPontomaisLoggedIn', 'lastUpdateCheck', 'lastUpdateResult', 'lastUpdateVersion'] as const;
type ExternalField = typeof EXTERNAL_FIELDS[number];

function pickExternal(settings: AppSettings): Pick<AppSettings, ExternalField> {
  return {
    isPontomaisLoggedIn: settings.isPontomaisLoggedIn,
    lastUpdateCheck: settings.lastUpdateCheck,
    lastUpdateResult: settings.lastUpdateResult,
    lastUpdateVersion: settings.lastUpdateVersion,
  };
}

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
    startMinimizedEnabled: true,
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

  private lastAutoSyncConfig = '';
  private externalSnapshot: Pick<AppSettings, ExternalField> | null = null;

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
    if (this.settings.smartSyncEnabled) return 'Inteligente';
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

  resetToRootScreen(): void {
    this.screenStack = [];
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
      this.resetToRootScreen();
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
      this.externalSnapshot = pickExternal(loadedSettings);
      this.lastAutoSyncConfig = this.autoSyncConfig();
      if (!ALARM_SOUND_OPTIONS.some(option => option.value === this.settings.alarmSound)) {
        this.settings.alarmSound = DEFAULT_ALARM_SOUND;
      }

      try {
        const actualAutostartStatus = await this.autostartService.isEnabled();

        if (actualAutostartStatus !== this.settings.autostartEnabled) {
          this.settings.autostartEnabled = actualAutostartStatus;
          await this.saveSettings();
        }
      } catch (error) {
        console.error('Erro ao consultar a inicialização com o sistema:', error);
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

  async saveSettings(): Promise<boolean> {
    await this.syncAutostart();

    try {
      await this.mergeExternalChanges();
      await invoke('save_settings', { settings: this.settings });
      this.externalSnapshot = pickExternal(this.settings);
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
      this.toastService.error('Não foi possível salvar as configurações');
      return false;
    }

    await this.configureAutoSyncIfChanged();
    return true;
  }

  // O Rust (desvincular a conta) e a home (verificar atualização) gravam no mesmo arquivo
  // enquanto o modal está aberto. Campo que o modal não mexeu desde que abriu fica com o
  // valor do disco, senão a cópia do modal desfaria o que eles gravaram.
  private async mergeExternalChanges(): Promise<void> {
    const snapshot = this.externalSnapshot;
    if (!snapshot) return;

    let onDisk: AppSettings | null;
    try {
      onDisk = await invoke<AppSettings>('load_settings');
    } catch {
      return;
    }
    if (!onDisk) return;

    const settings = this.settings as Record<ExternalField, unknown>;
    for (const field of EXTERNAL_FIELDS) {
      if (settings[field] === snapshot[field]) {
        settings[field] = onDisk[field];
      }
    }
  }

  // Uma falha do autostart não pode impedir que o resto das configurações seja salvo.
  private async syncAutostart(): Promise<void> {
    let current: boolean;
    try {
      current = await this.autostartService.isEnabled();
    } catch (error) {
      console.error('Erro ao consultar a inicialização com o sistema:', error);
      return;
    }

    if (this.settings.autostartEnabled === current) return;

    try {
      if (this.settings.autostartEnabled) {
        await this.autostartService.enable();
      } else {
        await this.autostartService.disable();
      }
    } catch (error) {
      console.error('Erro ao alterar a inicialização com o sistema:', error);
      this.settings.autostartEnabled = current;
      this.toastService.error('Não foi possível alterar a inicialização com o sistema');
    }
  }

  // Reconfigurar reinicia o laço, que busca na hora: só vale quando algo da sincronização mudou.
  private async configureAutoSyncIfChanged(): Promise<void> {
    const config = this.autoSyncConfig();
    if (config === this.lastAutoSyncConfig) return;

    try {
      await invoke('configure_auto_sync', JSON.parse(config));
      this.lastAutoSyncConfig = config;
    } catch (error) {
      console.error('Erro ao configurar a sincronização:', error);
    }
  }

  private autoSyncConfig(): string {
    const loggedIn = this.settings.isPontomaisLoggedIn;
    return JSON.stringify({
      enabled: this.settings.autoImportEnabled && loggedIn,
      intervalMins: this.settings.autoImportInterval,
      smart: this.settings.smartSyncEnabled && loggedIn
    });
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
      const login = this.integrationSettings.pontomaisLogin.trim();
      await this.pontoMaisService.authenticate({
        username: login,
        password: this.integrationSettings.pontomaisPassword
      });

      this.integrationSettings.pontomaisLogin = login;
      this.settings.pontomaisLogin = login;
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

      if (await this.saveSettings()) {
        this.toastService.success('Conta desconectada');
      }
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
      this.toastService.error('Erro ao desconectar a conta');
    }
  }

  onClose() {
    this.integrationSettings.pontomaisPassword = '';
    this.close.emit();
  }

  onOverlayClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }
}
