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

  it('respostas que chegariam fora de ordem terminam no estado da última gravação', async () => {
    mockIPC(async (cmd, args) => {
      const { patch } = args as { patch: { alarmVolume: number } };
      calls.push({ cmd, args });
      if (patch.alarmVolume === 10) await new Promise(resolve => setTimeout(resolve, 20));
      return { ...DEFAULT_SETTINGS, alarmVolume: patch.alarmVolume };
    });

    const first = store.update({ alarmVolume: 10 });
    const second = store.update({ alarmVolume: 20 });
    await Promise.all([first, second]);

    expect(calls.map(call => (call.args as { patch: { alarmVolume: number } }).patch.alarmVolume)).toEqual([10, 20]);
    expect(store.settings().alarmVolume).toBe(20);
  });

  it('uma gravação que falha não trava as seguintes', async () => {
    let attempt = 0;
    respond(() => {
      attempt++;
      if (attempt === 1) throw 'erro';
      return { ...DEFAULT_SETTINGS, alarmVolume: 50 };
    });

    await expect(store.update({ alarmVolume: 1 })).rejects.toBe('erro');
    await store.update({ alarmVolume: 50 });

    expect(store.settings().alarmVolume).toBe(50);
  });

  it('falha ao gravar não altera o estado', async () => {
    respond(() => {
      throw 'erro';
    });

    await expect(store.update({ alarmVolume: 10 })).rejects.toBe('erro');
    expect(store.settings()).toEqual(DEFAULT_SETTINGS);
  });
});
