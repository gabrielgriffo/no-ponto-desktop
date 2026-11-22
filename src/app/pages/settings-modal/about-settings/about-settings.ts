import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Update } from '@tauri-apps/plugin-updater';
import { UpdateService } from '../../../services/update.service';
import { ToastService } from '../../../services/toast.service';
import { AppInfo, AppSettings, SettingsPatch, isNewerVersion } from '../settings.model';

type UpdateState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready';
type CheckResult = 'up-to-date' | 'available' | 'ready' | 'error';

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

  // Recriado a cada visita à tela: o que já foi instalado vem do serviço, senão a
  // tela ofereceria baixar de novo uma atualização que só espera o reinício.
  protected readonly updateState = signal<UpdateState>(this.updateService.installed() ? 'ready' : 'idle');
  protected readonly downloadProgress = signal(0);
  private readonly pendingUpdate = signal<Update | null>(null);
  private readonly lastResult = signal<CheckResult | null>(this.updateService.installed() ? 'ready' : null);

  private readonly isWindows = computed(() => this.appInfo().os_platform.toLowerCase().startsWith('windows'));

  protected readonly isUpdateBusy = computed(() => {
    const state = this.updateState();
    return state === 'checking' || state === 'downloading' || state === 'ready';
  });

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

  protected readonly isUpdateAvailable = computed(() => {
    const result = this.lastResult();
    return result ? result === 'available' : this.hasCachedUpdate();
  });

  protected readonly canInstall = computed(() => !this.isUpdateBusy() && this.isUpdateAvailable());

  private readonly availableLabel = computed(() => {
    const version = this.pendingUpdate()?.version || this.settings().lastUpdateVersion;
    return version ? `Versão ${version} disponível` : 'Atualização disponível';
  });

  protected readonly statusLabel = computed(() => {
    switch (this.lastResult()) {
      case 'up-to-date': return 'Atualizado';
      case 'available': return this.availableLabel();
      case 'ready': return 'Pronto para reiniciar';
      case 'error': return 'Falha na verificação';
    }

    if (this.hasCachedUpdate()) return this.availableLabel();

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

    if (await this.resolvePendingUpdate(true)) {
      this.updateState.set('available');
    }
  }

  private async resolvePendingUpdate(notify: boolean): Promise<Update | null> {
    this.updateState.set('checking');
    const lastUpdateCheck = new Date().toISOString();

    try {
      const update = await this.updateService.checkForUpdate();
      this.updateService.available.set(update);
      this.patch.emit({
        lastUpdateCheck,
        lastUpdateResult: update ? 'available' : 'up-to-date',
        lastUpdateVersion: update?.version ?? '',
      });

      this.pendingUpdate.set(update);
      if (update) {
        this.lastResult.set('available');
        if (notify) this.toastService.info(`Versão ${update.version} disponível`);
      } else {
        this.updateState.set('up-to-date');
        this.lastResult.set('up-to-date');
        if (notify) this.toastService.success('Você já está na versão mais recente');
      }

      return update;
    } catch (error) {
      console.error('Erro ao verificar atualizações:', error);
      this.patch.emit({ lastUpdateCheck, lastUpdateResult: 'error', lastUpdateVersion: '' });

      this.pendingUpdate.set(null);
      this.lastResult.set('error');
      this.toastService.error('Não foi possível verificar atualizações');
      this.updateState.set('idle');
      return null;
    }
  }

  protected async onInstallUpdate(): Promise<void> {
    if (this.isUpdateBusy() || this.updateService.installing()) return;

    const update = this.pendingUpdate() ?? (await this.resolvePendingUpdate(false));
    if (!update) return;

    if (this.isWindows()) {
      this.toastService.info('O app será fechado para instalar a atualização');
    }

    this.updateState.set('downloading');
    this.downloadProgress.set(0);

    try {
      await this.updateService.downloadAndInstall(update, progress => {
        if (progress.contentLength) {
          this.downloadProgress.set(Math.round((progress.downloaded / progress.contentLength) * 100));
        }
      });

      this.updateState.set('ready');
      this.lastResult.set('ready');
      this.toastService.success('Atualização instalada, reinicie para aplicar');
    } catch (error) {
      console.error('Erro ao baixar/instalar atualização:', error);
      this.toastService.error('Não foi possível baixar a atualização');
      this.updateState.set('available');
    }
  }

  protected async onRelaunch(): Promise<void> {
    await this.updateService.relaunch();
  }
}
