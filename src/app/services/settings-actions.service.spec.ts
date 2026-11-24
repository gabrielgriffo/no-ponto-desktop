import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { SettingsActionsService } from './settings-actions.service';
import { AppSettings, DEFAULT_SETTINGS } from '../pages/settings-modal/settings.model';

describe('SettingsActionsService', () => {
  let service: SettingsActionsService;
  let saved: AppSettings;
  let calls: string[];
  let autostart: boolean;
  let failEnable: boolean;
  let failClearSession: boolean;

  beforeEach(() => {
    calls = [];
    saved = { ...DEFAULT_SETTINGS, isPontomaisLoggedIn: true };
    autostart = false;
    failEnable = false;
    failClearSession = false;
    mockIPC((cmd, args) => {
      calls.push(cmd);
      switch (cmd) {
        case 'load_settings':
          return saved;
        case 'update_settings':
          saved = { ...saved, ...(args as { patch: Partial<AppSettings> }).patch };
          return saved;
        case 'plugin:autostart|is_enabled':
          return autostart;
        case 'plugin:autostart|enable':
          if (failEnable) throw 'negado';
          autostart = true;
          return undefined;
        case 'pontomais_clear_session':
          if (failClearSession) throw 'offline';
          return undefined;
        default:
          return undefined;
      }
    });
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(SettingsActionsService);
  });

  afterEach(() => clearMocks());

  it('ligar o início com o sistema ativa o autostart e grava o resultado', async () => {
    await service.applyPatch({ autostartEnabled: true });

    expect(calls).toContain('plugin:autostart|enable');
    expect(saved.autostartEnabled).toBe(true);
  });

  it('se o sistema recusar o autostart, grava o estado real', async () => {
    failEnable = true;
    await service.applyPatch({ autostartEnabled: true });

    expect(saved.autostartEnabled).toBe(false);
  });

  it('desconectar marca a conta como desconectada mesmo sem rede', async () => {
    failClearSession = true;
    await service.logout();

    expect(saved.isPontomaisLoggedIn).toBe(false);
  });

  it('login sem senha não chega ao Rust', async () => {
    expect(await service.authenticate('a@x.com', '')).toBe(false);
    expect(calls).not.toContain('pontomais_authenticate');
  });
});
