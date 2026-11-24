import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const CHECK_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

@Injectable({ providedIn: 'root' })
export class UpdateService {
  readonly available = signal<Update | null>(null);
  readonly downloading = signal(false);
  readonly progress = signal(0);
  readonly downloadFailed = signal(false);
  readonly ready = signal<Update | null>(null);
  readonly installing = signal(false);
  readonly installed = signal(false);

  private download: Promise<void> = Promise.resolve();

  async check(): Promise<Update | null> {
    const update = await check({ timeout: CHECK_TIMEOUT_MS });
    this.available.set(update);
    if (update && update.version !== this.ready()?.version) {
      this.download = this.startDownload(update);
    }
    return update;
  }

  whenDownloaded(): Promise<void> {
    return this.download;
  }

  async retryDownload(): Promise<void> {
    const update = this.available();
    if (!update || this.downloading() || this.ready()) return;
    this.download = this.startDownload(update);
    await this.download;
  }

  async install(): Promise<void> {
    const update = this.ready();
    if (!update || this.installing()) return;
    this.installing.set(true);

    try {
      await invoke('prepare_update_relaunch').catch(error =>
        console.error('Erro ao marcar o reinício da atualização:', error)
      );
      await update.install();
      this.ready.set(null);
      this.available.set(null);
      this.installed.set(true);
      await relaunch();
    } finally {
      this.installing.set(false);
    }
  }

  private async startDownload(update: Update): Promise<void> {
    if (this.downloading()) return;
    this.downloading.set(true);
    this.downloadFailed.set(false);
    this.progress.set(0);

    let downloaded = 0;
    let total: number | undefined;
    try {
      await update.download(
        event => {
          if (event.event === 'Started') total = event.data.contentLength;
          if (event.event === 'Progress') downloaded += event.data.chunkLength;
          if (total) this.progress.set(Math.round((downloaded / total) * 100));
        },
        { timeout: DOWNLOAD_TIMEOUT_MS }
      );
      this.ready.set(update);
    } catch (error) {
      console.error('Erro ao baixar a atualização:', error);
      this.downloadFailed.set(true);
    } finally {
      this.downloading.set(false);
    }
  }
}
