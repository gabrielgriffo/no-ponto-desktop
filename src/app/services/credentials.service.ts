import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

export interface StoredToken {
  token: string;
  client_id: string;
  expiry: string;
  uid: string;
}

@Injectable({
  providedIn: 'root'
})
export class CredentialsService {
  /**
   * Salva o token de autenticação no keyring nativo do sistema operacional
   */
  async saveToken(tokenData: StoredToken): Promise<boolean> {
    try {
      await invoke('save_pontomais_token', { token: tokenData });
      return true;
    } catch (error) {
      console.error('Erro ao salvar token:', error);
      return false;
    }
  }

  /**
   * Recupera o token salvo
   */
  async getToken(): Promise<StoredToken | null> {
    try {
      return await invoke<StoredToken | null>('get_pontomais_token');
    } catch (error) {
      console.error('Erro ao recuperar token:', error);
      return null;
    }
  }

  /**
   * Remove o token salvo (logout)
   */
  async deleteToken(): Promise<boolean> {
    try {
      await invoke('delete_pontomais_token');
      return true;
    } catch (error) {
      console.error('Erro ao deletar token:', error);
      return false;
    }
  }

  /**
   * Verifica se existe um token salvo
   */
  async hasToken(): Promise<boolean> {
    return (await this.getToken()) !== null;
  }
}
