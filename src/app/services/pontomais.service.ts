import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

export interface PontoMaisCredentials {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  client_id: string;
  uid: string;
  expiry: string;
}

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

  async authenticate(credentials: PontoMaisCredentials): Promise<AuthResponse> {
    return await invoke<AuthResponse>('pontomais_authenticate', { credentials });
  }

  async restoreSession(token: string, clientId: string, expiry: string, uid: string): Promise<void> {
    await invoke('pontomais_restore_session', {
      token,
      clientId,
      expiry,
      uid
    });
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
