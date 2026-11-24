import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { UpdateService } from './update.service';

const METADATA = { rid: 1, currentVersion: '0.1.0', version: '9.9.9', date: null, body: '', rawJson: {} };

describe('UpdateService', () => {
  let service: UpdateService;
  let calls: { cmd: string; args: any }[];
  let available: boolean;
  let failDownload: boolean;

  beforeEach(() => {
    calls = [];
    available = true;
    failDownload = false;
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'plugin:updater|check') return available ? METADATA : null;
      if (cmd === 'plugin:updater|download') {
        if (failDownload) throw 'rede caiu';
        return 2;
      }
      return null;
    });
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(UpdateService);
  });

  afterEach(() => clearMocks());

  const commands = () => calls.map(call => call.cmd).filter(cmd => !cmd.startsWith('plugin:resources'));

  it('baixa sozinho assim que encontra uma versão nova', async () => {
    const update = await service.check();
    await service.whenDownloaded();

    expect(update?.version).toBe('9.9.9');
    expect(commands()).toEqual(['plugin:updater|check', 'plugin:updater|download']);
    expect(service.ready()?.version).toBe('9.9.9');
    expect(service.downloading()).toBe(false);
  });

  it('sem versão nova não baixa nada', async () => {
    available = false;
    await service.check();
    await service.whenDownloaded();

    expect(commands()).toEqual(['plugin:updater|check']);
    expect(service.ready()).toBeNull();
  });

  it('o clique instala o pacote já baixado, marca o reinício antes e reinicia no fim', async () => {
    await service.check();
    await service.whenDownloaded();
    calls = [];

    await service.install();

    expect(commands()).toEqual(['prepare_update_relaunch', 'plugin:updater|install', 'plugin:process|restart']);
    expect(calls.find(call => call.cmd === 'plugin:updater|install')?.args).toEqual({ updateRid: 1, bytesRid: 2 });
    expect(service.installed()).toBe(true);
  });

  it('falha no download não deixa nada pronto e permite tentar de novo', async () => {
    failDownload = true;
    await service.check();
    await service.whenDownloaded();

    expect(service.ready()).toBeNull();
    expect(service.downloadFailed()).toBe(true);

    failDownload = false;
    await service.retryDownload();

    expect(service.ready()?.version).toBe('9.9.9');
    expect(service.downloadFailed()).toBe(false);
  });

  it('sem pacote baixado o clique não instala', async () => {
    await service.install();

    expect(commands()).toEqual([]);
  });
});
