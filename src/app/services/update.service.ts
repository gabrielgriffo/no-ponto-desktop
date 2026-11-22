import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
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
  readonly available = signal<Update | null>(null);
  readonly installing = signal(false);
  /** Instalada nesta execução, faltando reiniciar. Sobrevive à troca de telas. */
  readonly installed = signal(false);

  /** Verifica se há uma atualização disponível. Retorna null se já está na última versão. */
  async checkForUpdate(): Promise<Update | null> {
    return await check();
  }

  /** Baixa e instala a atualização, reportando progresso via callback. */
  async downloadAndInstall(update: Update, onProgress?: (progress: UpdateProgress) => void): Promise<void> {
    // O cabeçalho e a tela Sobre instalam pela mesma atualização; quem chega com outra
    // instalação em andamento não começa uma segunda.
    if (this.installing()) throw new Error('Atualização já em andamento');
    this.installing.set(true);

    try {
      // O instalador e o reinício repassam os argumentos desta instância: sem o
      // marcador, um app iniciado com o sistema voltaria escondido depois de atualizar.
      await invoke('prepare_update_relaunch').catch(error =>
        console.error('Erro ao marcar o reinício da atualização:', error)
      );
      await this.runDownloadAndInstall(update, (progress) => onProgress?.(progress));
      this.available.set(null);
      this.installed.set(true);
    } finally {
      this.installing.set(false);
    }
  }

  private async runDownloadAndInstall(update: Update, onProgress: (progress: UpdateProgress) => void): Promise<void> {
    let downloaded = 0;
    let contentLength: number | undefined;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength;
          onProgress({ downloaded, contentLength });
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          onProgress({ downloaded, contentLength });
          break;
        case 'Finished':
          onProgress({ downloaded, contentLength });
          break;
      }
    });
  }

  /** Reinicia o app para concluir a instalação da atualização. */
  async relaunch(): Promise<void> {
    await relaunch();
  }
}
