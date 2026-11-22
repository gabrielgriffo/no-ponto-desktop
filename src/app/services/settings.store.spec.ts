import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { SettingsStore } from './settings.store';
import { DEFAULT_SETTINGS } from '../pages/settings-modal/settings.model';

describe('SettingsStore', () => {
  let store: SettingsStore;
  let calls: { cmd: string; args: unknown }[];

  function respond(handler: (cmd: string) => unknown) {
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return handler(cmd);
    });
  }

  beforeEach(() => {
    calls = [];
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    store = TestBed.inject(SettingsStore);
  });

  afterEach(() => clearMocks());

  it('começa com os padrões e passa a refletir o disco depois de carregar', async () => {
    expect(store.settings()).toEqual(DEFAULT_SETTINGS);

    respond(() => ({ ...DEFAULT_SETTINGS, alarmEnabled: true }));
    await store.load();

    expect(calls.map(call => call.cmd)).toEqual(['load_settings']);
    expect(store.settings().alarmEnabled).toBe(true);
  });

  it('envia só o patch e adota o resultado devolvido pelo Rust', async () => {
    respond(() => ({ ...DEFAULT_SETTINGS, alarmVolume: 30, pontomaisLogin: 'gravado-por-outro' }));

    await store.update({ alarmVolume: 30 });

    expect(calls).toEqual([{ cmd: 'update_settings', args: { patch: { alarmVolume: 30 } } }]);
    expect(store.settings().pontomaisLogin).toBe('gravado-por-outro');
  });

  it('falha ao gravar não altera o estado', async () => {
    respond(() => {
      throw 'erro';
    });

    await expect(store.update({ alarmVolume: 10 })).rejects.toBe('erro');
    expect(store.settings()).toEqual(DEFAULT_SETTINGS);
  });
});
