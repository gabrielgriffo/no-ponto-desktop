import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { SettingsRow } from './settings-row/settings-row';
import { SettingsGroup } from './settings-group/settings-group';
import { IntegrationSettingsComponent } from './integration-settings/integration-settings';
import { AboutSettingsComponent } from './about-settings/about-settings';
import { SyncSettingsComponent } from './screens/sync-settings/sync-settings';
import { WorkdaySettingsComponent } from './screens/workday-settings/workday-settings';
import { AlertsSettingsComponent } from './screens/alerts-settings/alerts-settings';
import { StartupSettingsComponent } from './screens/startup-settings/startup-settings';
import { ExternalAppSettingsComponent } from './screens/external-app-settings/external-app-settings';
import { ToastService } from '../../services/toast.service';
import { PontoMaisService } from '../../services/pontomais.service';
import { AutostartService } from '../../services/autostart.service';
import { SettingsStore } from '../../services/settings.store';
import { AutoSyncService } from '../../services/auto-sync.service';
import {
  ALARM_SOUND_OPTIONS,
  AppInfo,
  DEFAULT_ALARM_SOUND,
  INTERVAL_OPTIONS,
  SettingsPatch,
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

const EMPTY_APP_INFO: AppInfo = {
  version: '',
  product_name: '',
  tauri_version: '',
  architecture: '',
  os_platform: '',
  build_type: '',
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class SettingsModal {
  private readonly toastService = inject(ToastService);
  private readonly pontoMaisService = inject(PontoMaisService);
  private readonly autostartService = inject(AutostartService);
  private readonly store = inject(SettingsStore);
  private readonly autoSync = inject(AutoSyncService);

  readonly isOpen = input(false);
  readonly close = output<void>();

  private readonly modalContainer = viewChild<ElementRef<HTMLDivElement>>('modalContainer');

  protected readonly settings = this.store.settings;
  protected readonly appInfo = signal(EMPTY_APP_INFO);
  protected readonly settingsLoaded = signal(false);
  protected readonly isLoggingIn = signal(false);
  protected readonly isLoggingOut = signal(false);
  protected readonly loginDraft = signal('');
  protected readonly passwordDraft = signal('');

  private readonly screenStack = signal<ScreenId[]>([]);
  protected readonly currentScreen = computed(() => this.screenStack().at(-1) ?? null);
  protected readonly title = computed(() => {
    const screen = this.currentScreen();
    return screen ? SCREEN_TITLES[screen] : 'Configurações';
  });

  protected readonly accountValue = computed(() => {
    const { isPontomaisLoggedIn, pontomaisLogin } = this.settings();
    if (!isPontomaisLoggedIn) return 'Não conectada';
    return pontomaisLogin || 'Conectada';
  });

  protected readonly syncValue = computed(() => {
    const { smartSyncEnabled, autoImportEnabled, autoImportInterval } = this.settings();
    if (smartSyncEnabled) return 'Inteligente';
    if (!autoImportEnabled) return '';
    const option = INTERVAL_OPTIONS.find(opt => opt.value === autoImportInterval);
    return option?.label ?? `${autoImportInterval} minutos`;
  });

  protected readonly hasUpdate = computed(() => {
    const { lastUpdateResult, lastUpdateVersion } = this.settings();
    return lastUpdateResult === 'available' && isNewerVersion(lastUpdateVersion, this.appInfo().version);
  });

  protected readonly workdayValue = computed(() => formatWorkday(this.settings().expectedWorkdayMinutes));

  protected readonly alertsValue = computed(() => {
    const { alarmEnabled, notificationEnabled } = this.settings();
    if (alarmEnabled && notificationEnabled) return 'Alarme e notificação';
    if (alarmEnabled) return 'Alarme';
    if (notificationEnabled) return 'Notificação';
    return '';
  });

  protected readonly externalAppValue = computed(() => {
    const { externalAppAutostartEnabled, externalApp } = this.settings();
    return externalAppAutostartEnabled ? externalApp?.name ?? '' : '';
  });

  constructor() {
    this.loadAppInfo();

    effect(() => {
      if (this.isOpen()) untracked(() => this.onOpen());
    });
  }

  protected openScreen(screen: ScreenId): void {
    this.screenStack.update(stack => [...stack, screen]);
  }

  protected goBack(): void {
    this.screenStack.update(stack => stack.slice(0, -1));
  }

  resetToRootScreen(): void {
    this.screenStack.set([]);
  }

  protected onEscape(): void {
    // Sair no meio do login faria a home conferir a sessão antes de o token existir.
    if (!this.isOpen() || this.isLoggingIn()) return;

    if (this.screenStack().length) {
      this.goBack();
    } else {
      this.onClose();
    }
  }

  private async onOpen(): Promise<void> {
    this.resetToRootScreen();
    this.settingsLoaded.set(false);

    await this.loadSettings();
    this.settingsLoaded.set(true);

    setTimeout(() => this.modalContainer()?.nativeElement.focus(), 0);
  }

  private async loadSettings(): Promise<void> {
    try {
      const loaded = await this.store.load();
      const reconcile: SettingsPatch = {};

      if (!ALARM_SOUND_OPTIONS.some(option => option.value === loaded.alarmSound)) {
        reconcile.alarmSound = DEFAULT_ALARM_SOUND;
      }

      try {
        const autostart = await this.autostartService.isEnabled();
        if (autostart !== loaded.autostartEnabled) reconcile.autostartEnabled = autostart;
      } catch (error) {
        console.error('Erro ao consultar a inicialização com o sistema:', error);
      }

      // O Rust diz se há conta vinculada; nem token nem senha passam por aqui. Cofre
      // ilegível não é conta desconectada: o estado salvo continua valendo.
      try {
        const connected = (await this.pontoMaisService.ensureSession()) === 'connected';
        if (connected !== loaded.isPontomaisLoggedIn) reconcile.isPontomaisLoggedIn = connected;
      } catch (error) {
        console.error('Erro ao restaurar sessão no modal:', error);
      }

      if (Object.keys(reconcile).length) {
        await this.persist(reconcile);
      }

      this.loginDraft.set(this.settings().pontomaisLogin);
      this.passwordDraft.set('');
    } catch (error) {
      console.error('Erro ao carregar configurações:', error);
    }
  }

  private async loadAppInfo(): Promise<void> {
    try {
      this.appInfo.set(await invoke<AppInfo>('get_app_info'));
    } catch (error) {
      console.error('Erro ao carregar informações do app:', error);
    }
  }

  /** Alteração vinda de uma tela: aplica efeitos no sistema antes de gravar. */
  protected async applyPatch(patch: SettingsPatch): Promise<boolean> {
    if (patch.autostartEnabled !== undefined) {
      patch = { ...patch, autostartEnabled: await this.syncAutostart(patch.autostartEnabled) };
    }
    return this.persist(patch);
  }

  private async persist(patch: SettingsPatch): Promise<boolean> {
    try {
      await this.store.update(patch);
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
      this.toastService.error('Não foi possível salvar as configurações');
      return false;
    }

    await this.applyAutoSync();
    return true;
  }

  /** Devolve o estado real depois da tentativa. Falhar aqui não impede o resto de ser salvo. */
  private async syncAutostart(wanted: boolean): Promise<boolean> {
    let current: boolean;
    try {
      current = await this.autostartService.isEnabled();
    } catch (error) {
      console.error('Erro ao consultar a inicialização com o sistema:', error);
      return wanted;
    }

    if (wanted === current) return current;

    try {
      if (wanted) {
        await this.autostartService.enable();
      } else {
        await this.autostartService.disable();
      }
      return wanted;
    } catch (error) {
      console.error('Erro ao alterar a inicialização com o sistema:', error);
      this.toastService.error('Não foi possível alterar a inicialização com o sistema');
      return current;
    }
  }

  private async applyAutoSync(): Promise<void> {
    try {
      await this.autoSync.apply(this.settings(), this.settings().isPontomaisLoggedIn);
    } catch (error) {
      console.error('Erro ao configurar a sincronização:', error);
    }
  }

  protected async onSaveCredentials(): Promise<void> {
    const login = this.loginDraft().trim();
    const password = this.passwordDraft();
    if (!login || !password) {
      this.toastService.error('Preencha login e senha', 3000);
      return;
    }

    this.isLoggingIn.set(true);

    try {
      // O Rust autentica e grava junto o token, a conta vinculada nas configurações e,
      // se a Reconexão Automática estiver ligada, a senha. Aqui não sobra credencial.
      await this.pontoMaisService.authenticate({ username: login, password });

      this.loginDraft.set(login);
      this.passwordDraft.set('');

      // Sem toast de sucesso: a tela troca o formulário pela conta conectada.
      await this.store.load();
      await this.applyAutoSync();
    } catch (error) {
      console.error('Erro ao fazer login:', error);
      const message = typeof error === 'string' ? error : 'Erro ao fazer login. Verifique suas credenciais.';
      this.toastService.error(message);
    } finally {
      this.isLoggingIn.set(false);
    }
  }

  protected async onLogout(): Promise<void> {
    if (this.isLoggingOut()) return;
    this.isLoggingOut.set(true);

    try {
      // Isolado: uma falha ao revogar na API não pode deixar a conta presa como conectada.
      try {
        await this.pontoMaisService.clearSession();
      } catch (error) {
        console.error('Erro ao encerrar sessão no PontoMais:', error);
      }

      this.passwordDraft.set('');

      if (await this.persist({ isPontomaisLoggedIn: false })) {
        this.toastService.success('Conta desconectada');
      }
    } finally {
      this.isLoggingOut.set(false);
    }
  }

  protected onClose(): void {
    if (this.isLoggingIn()) return;
    this.passwordDraft.set('');
    this.close.emit();
  }

  protected onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }
}
