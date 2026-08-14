import { Injectable } from '@angular/core';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export interface UpdateProgress {
  downloaded: number;
  contentLength?: number;
}

@Injectable({
  providedIn: 'root'
})
export class UpdateService {
  /** Verifica se há uma atualização disponível. Retorna null se já está na última versão. */
  async checkForUpdate(): Promise<Update | null> {
    return await check();
  }

  /** Baixa e instala a atualização, reportando progresso via callback. */
  async downloadAndInstall(update: Update, onProgress?: (progress: UpdateProgress) => void): Promise<void> {
    let downloaded = 0;
    let contentLength: number | undefined;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength;
          onProgress?.({ downloaded, contentLength });
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          onProgress?.({ downloaded, contentLength });
          break;
        case 'Finished':
          onProgress?.({ downloaded, contentLength });
          break;
      }
    });
  }

  /** Reinicia o app para concluir a instalação da atualização. */
  async relaunch(): Promise<void> {
    await relaunch();
  }
}
