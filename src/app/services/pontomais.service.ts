import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

export interface PontoMaisCredentials {
  username: string;
  password: string;
}

/** Estado da conta devolvido pelo Rust. Nenhuma credencial atravessa junto. */
export type SessionStatus = 'connected' | 'signedOut';

export interface TimeCard {
  id: number;
  disabled: boolean;
  latitude: number;
  longitude: number;
  address: string;
  original_latitude: number;
  original_longitude: number;
  original_address: string;
  location_edited: boolean;
  accuracy: number;
  ip: string;
  offline: boolean;
  date: string;
  time: string;
  updated_at: number;
  register_type: {
    id: number;
    name: string;
  };
  source: {
    id: number;
    name: string;
  };
  software_method: {
    id: number;
    name: string;
  };
}

export interface WorkDay {
  time_cards: TimeCard[];
}

export interface WorkDaysResponse {
  work_days: WorkDay[];
  meta: {
    now: number;
    ip: string;
    obfuscated: boolean;
  };
}

@Injectable({
  providedIn: 'root'
})
export class PontoMaisService {

  /**
   * Conecta a conta. A senha vai para o Rust e não volta: a resposta é só o sucesso
   * ou a mensagem do erro. Quem grava token e senha no cofre é o Rust.
   */
  async authenticate(credentials: PontoMaisCredentials): Promise<void> {
    await invoke('pontomais_authenticate', { credentials });
  }

  /**
   * Põe a sessão de pé a partir do cofre do sistema. Sem argumentos e sem segredos
   * na resposta — só o estado da conta.
   */
  async ensureSession(): Promise<SessionStatus> {
    return await invoke<SessionStatus>('pontomais_ensure_session');
  }

  /** Revoga o token na API e zera a sessão mantida no estado do Rust. */
  async clearSession(): Promise<void> {
    await invoke('pontomais_clear_session');
  }

  async getCurrentWorkDay(date: string): Promise<WorkDaysResponse> {
    return await invoke<WorkDaysResponse>('pontomais_current_workday', { date });
  }

  async getSession(): Promise<any> {
    return await invoke('pontomais_session');
  }

  async getCompTime(): Promise<any> {
    return await invoke('pontomais_comp_time');
  }
}
