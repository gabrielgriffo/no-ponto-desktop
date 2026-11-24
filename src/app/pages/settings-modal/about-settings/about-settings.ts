import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { UpdateService } from '../../../services/update.service';
import { ToastService } from '../../../services/toast.service';
import { AppInfo, AppSettings, SettingsPatch, isNewerVersion } from '../settings.model';

type CheckResult = 'up-to-date' | 'error';

const pad = (n: number) => String(n).padStart(2, '0');

@Component({
  selector: 'app-about-settings',
  templateUrl: './about-settings.html',
  styleUrl: './about-settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutSettingsComponent {
  private readonly updateService = inject(UpdateService);
  private readonly toastService = inject(ToastService);

  readonly appInfo = input.required<AppInfo>();
  readonly settings = input.required<AppSettings>();
  readonly patch = output<SettingsPatch>();

  protected readonly checking = signal(false);
  private readonly lastResult = signal<CheckResult | null>(null);

  protected readonly downloading = this.updateService.downloading;
  protected readonly progress = this.updateService.progress;
  protected readonly downloadFailed = this.updateService.downloadFailed;
  protected readonly ready = this.updateService.ready;
  protected readonly installing = this.updateService.installing;

  protected readonly isUpdateBusy = computed(() => this.checking() || this.downloading() || this.installing());

  protected readonly lastCheckLabel = computed(() => {
    const raw = this.settings().lastUpdateCheck;
    if (!raw) return 'Nunca';

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'Nunca';

    const day = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  });

  private readonly hasCachedUpdate = computed(() => {
    const { lastUpdateResult, lastUpdateVersion } = this.settings();
    return lastUpdateResult === 'available' && isNewerVersion(lastUpdateVersion, this.appInfo().version);
  });

  private readonly newVersion = computed(
    () => this.updateService.available()?.version || this.settings().lastUpdateVersion
  );

  protected readonly isUpdateAvailable = computed(
    () => !!this.updateService.available() || (!this.lastResult() && this.hasCachedUpdate())
  );

  protected readonly statusLabel = computed(() => {
    const version = this.newVersion();
    if (this.installing()) return 'Instalando...';
    if (this.ready()) return `Versão ${version} pronta para instalar`;
    if (this.downloading()) return `Baixando a versão ${version}`;
    if (this.downloadFailed()) return 'Falha ao baixar a atualização';
    if (this.updateService.available()) return `Versão ${version} disponível`;

    switch (this.lastResult()) {
      case 'up-to-date': return 'Atualizado';
      case 'error': return 'Falha na verificação';
    }

    if (this.hasCachedUpdate()) return version ? `Versão ${version} disponível` : 'Atualização disponível';

    switch (this.settings().lastUpdateResult) {
      case 'up-to-date':
      case 'available':
        return 'Atualizado';
      case 'error':
        return 'Falha na verificação';
      default:
        return 'Não verificado';
    }
  });

  protected async onCheckForUpdate(): Promise<void> {
    if (this.isUpdateBusy()) return;
    this.checking.set(true);
    const lastUpdateCheck = new Date().toISOString();

    try {
      const update = await this.updateService.check();
      this.patch.emit({
        lastUpdateCheck,
        lastUpdateResult: update ? 'available' : 'up-to-date',
        lastUpdateVersion: update?.version ?? '',
      });

      if (update) {
        this.lastResult.set(null);
        this.toastService.info(`Versão ${update.version} disponível`);
      } else {
        this.lastResult.set('up-to-date');
        this.toastService.success('Você já está na versão mais recente');
      }
    } catch (error) {
      console.error('Erro ao verificar atualizações:', error);
      this.patch.emit({ lastUpdateCheck, lastUpdateResult: 'error', lastUpdateVersion: '' });
      this.lastResult.set('error');
      this.toastService.error('Não foi possível verificar atualizações');
    } finally {
      this.checking.set(false);
    }
  }

  protected async onRetryDownload(): Promise<void> {
    await this.updateService.retryDownload();
    if (this.downloadFailed()) this.toastService.error('Não foi possível baixar a atualização');
  }

  protected async onInstall(): Promise<void> {
    try {
      await this.updateService.install();
    } catch (error) {
      console.error('Erro ao instalar a atualização:', error);
      this.toastService.error('Não foi possível instalar a atualização');
    }
  }
}
