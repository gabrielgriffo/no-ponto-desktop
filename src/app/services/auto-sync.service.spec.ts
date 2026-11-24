import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { AutoSyncService } from './auto-sync.service';
import { DEFAULT_SETTINGS } from '../pages/settings-modal/settings.model';

describe('AutoSyncService', () => {
  let service: AutoSyncService;
  let calls: unknown[];
  let fail = false;

  beforeEach(() => {
    calls = [];
    fail = false;
    mockIPC((cmd, args) => {
      if (cmd !== 'configure_auto_sync') return;
      if (fail) throw 'erro';
      calls.push(args);
    });
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(AutoSyncService);
  });

  afterEach(() => clearMocks());

  const smart = { ...DEFAULT_SETTINGS, smartSyncEnabled: true };

  it('aplica uma vez e não reinicia o laço quando nada mudou', async () => {
    await service.apply(smart, true);
    await service.apply(smart, true);

    expect(calls).toEqual([{ enabled: false, intervalMins: 30, smart: true, launchOnFirstSync: true }]);
  });

  it('sem conta conectada desliga o laço mesmo com a sincronização ligada', async () => {
    await service.apply(smart, true);
    await service.apply(smart, false);

    expect(calls.at(-1)).toEqual({ enabled: false, intervalMins: 30, smart: false, launchOnFirstSync: true });
  });

  it('mudança nas configurações reinicia o laço sem abrir o app externo na primeira busca', async () => {
    await service.apply(smart, true, false);

    expect(calls).toEqual([{ enabled: false, intervalMins: 30, smart: true, launchOnFirstSync: false }]);
  });

  it('uma falha não conta como aplicada e a próxima chamada tenta de novo', async () => {
    fail = true;
    await expect(service.apply(smart, true)).rejects.toBe('erro');

    fail = false;
    await service.apply(smart, true);
    expect(calls).toHaveLength(1);
  });
});
