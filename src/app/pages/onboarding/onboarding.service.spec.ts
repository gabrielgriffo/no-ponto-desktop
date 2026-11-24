import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { OnboardingService } from './onboarding.service';
import { AutoSyncService } from '../../services/auto-sync.service';
import { ToastService } from '../../services/toast.service';
import { AppSettings, DEFAULT_SETTINGS } from '../settings-modal/settings.model';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let saved: AppSettings;
  let patches: unknown[];

  function withSettings(initial: Partial<AppSettings>) {
    saved = { ...DEFAULT_SETTINGS, ...initial };
    mockIPC((cmd, args) => {
      if (cmd === 'load_settings') return saved;
      if (cmd === 'update_settings') {
        const { patch } = args as { patch: Partial<AppSettings> };
        patches.push(patch);
        saved = { ...saved, ...patch };
        return saved;
      }
      return undefined;
    });
  }

  beforeEach(() => {
    patches = [];
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(OnboardingService);
  });

  afterEach(() => clearMocks());

  it('na primeira abertura mostra o assistente e marca como em andamento', async () => {
    withSettings({});
    await service.decide();

    expect(service.status()).toBe('active');
    expect(patches).toEqual([{ onboardingState: 'pending' }]);
  });

  it('quem já tinha conta conectada não vê o assistente', async () => {
    withSettings({ isPontomaisLoggedIn: true });
    await service.decide();

    expect(service.status()).toBe('off');
    expect(saved.onboardingState).toBe('done');
  });

  it('retoma o assistente interrompido sem regravar o estado', async () => {
    withSettings({ onboardingState: 'pending', isPontomaisLoggedIn: true });
    await service.decide();

    expect(service.status()).toBe('active');
    expect(patches).toEqual([]);
  });

  it('concluir grava o estado e libera a tela principal', async () => {
    withSettings({ onboardingState: 'pending' });
    await service.decide();
    await service.finish();

    expect(service.status()).toBe('off');
    expect(saved.onboardingState).toBe('done');
  });

  it('concluir libera a sincronização configurada no assistente para ser aplicada pela tela principal', async () => {
    const configured: unknown[] = [];
    saved = { ...DEFAULT_SETTINGS, onboardingState: 'pending', smartSyncEnabled: true };
    mockIPC((cmd, args) => {
      if (cmd === 'load_settings') return saved;
      if (cmd === 'update_settings') {
        saved = { ...saved, ...(args as { patch: Partial<AppSettings> }).patch };
        return saved;
      }
      if (cmd === 'configure_auto_sync') configured.push(args);
      return undefined;
    });
    const autoSync = TestBed.inject(AutoSyncService);

    await service.decide();
    await autoSync.apply(saved, true, false);
    await service.finish();
    await autoSync.apply(saved, true);

    expect(configured.length).toBe(2);
    expect((configured[1] as { launchOnFirstSync: boolean }).launchOnFirstSync).toBe(true);
  });

  it('avisa quando não consegue gravar a conclusão', async () => {
    withSettings({ onboardingState: 'pending' });
    await service.decide();
    mockIPC(cmd => {
      if (cmd === 'update_settings') throw 'disco cheio';
      return saved;
    });
    const toast = TestBed.inject(ToastService);
    const shown: string[] = [];
    const original = toast.error.bind(toast);
    toast.error = (message: string, duration?: number) => {
      shown.push(message);
      original(message, duration);
    };

    await service.finish();

    expect(shown.some(message => message.includes('configuração inicial'))).toBe(true);
    expect(service.status()).toBe('off');
  });

  it('se as configurações não carregarem, segue para a tela principal', async () => {
    mockIPC(() => {
      throw 'falhou';
    });
    await service.decide();

    expect(service.status()).toBe('off');
  });
});
