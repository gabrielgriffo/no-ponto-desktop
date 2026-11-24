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
import { SettingsActionsService } from '../../services/settings-actions.service';
import {
  AppInfo,
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
  private readonly actions = inject(SettingsActionsService);

  readonly isOpen = input(false);
  readonly close = output<void>();

  private readonly modalContainer = viewChild<ElementRef<HTMLDivElement>>('modalContainer');

  protected readonly settings = this.actions.settings;
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
      await this.actions.loadAndReconcile();
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

  protected applyPatch(patch: SettingsPatch): Promise<boolean> {
    return this.actions.applyPatch(patch);
  }

  protected async onSaveCredentials(): Promise<void> {
    const login = this.loginDraft().trim();
    this.isLoggingIn.set(true);

    try {
      if (await this.actions.authenticate(login, this.passwordDraft())) {
        this.loginDraft.set(login);
        this.passwordDraft.set('');
      }
    } finally {
      this.isLoggingIn.set(false);
    }
  }

  protected async onLogout(): Promise<void> {
    if (this.isLoggingOut()) return;
    this.isLoggingOut.set(true);

    try {
      this.passwordDraft.set('');
      await this.actions.logout();
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
