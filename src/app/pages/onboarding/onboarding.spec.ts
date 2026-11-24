import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { Onboarding } from './onboarding';
import { OnboardingService } from './onboarding.service';
import { SettingsStore } from '../../services/settings.store';
import { AppSettings, DEFAULT_SETTINGS } from '../settings-modal/settings.model';

describe('Onboarding', () => {
  let saved: AppSettings;
  let calls: string[];
  let session: 'connected' | 'signedOut';

  beforeEach(async () => {
    calls = [];
    session = 'signedOut';
    saved = { ...DEFAULT_SETTINGS, onboardingState: 'pending' };
    mockIPC((cmd, args) => {
      calls.push(cmd);
      switch (cmd) {
        case 'load_settings':
          return saved;
        case 'update_settings':
          saved = { ...saved, ...(args as { patch: Partial<AppSettings> }).patch };
          return saved;
        case 'pontomais_ensure_session':
          return session;
        case 'plugin:autostart|is_enabled':
          return false;
        case 'notification_status':
          return 'enabled';
        default:
          return undefined;
      }
    }, { shouldMockEvents: true });
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    await TestBed.inject(SettingsStore).load();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    clearMocks();
  });

  async function render() {
    const fixture = TestBed.createComponent(Onboarding);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll('button')].find(b => b.textContent?.trim() === text) as HTMLButtonElement;

  it('sem conta, começa pela conta e mostra o formulário de login', async () => {
    const { el } = await render();

    expect(el.querySelector('h1')?.textContent).toContain('PontoMais');
    expect(el.querySelector('app-integration-settings input[type="password"]')).not.toBeNull();
    expect(el.querySelector('.eyebrow')?.textContent).toContain('etapa 1 de 4');
  });

  it('pular a conta pede confirmação e avança para o alarme', async () => {
    const { fixture, el } = await render();

    button(el, 'Pular').click();
    fixture.detectChanges();
    expect(el.querySelector('.dialog h2')?.textContent).toContain('Pular a conta do PontoMais?');
    expect(el.querySelectorAll('.dialog li').length).toBeGreaterThan(0);

    button(el, 'Pular mesmo assim').click();
    fixture.detectChanges();
    expect(el.querySelector('.dialog')).toBeNull();
    expect(el.querySelector('h1')?.textContent).toContain('expediente acabar');
  });

  it('voltar da confirmação mantém a etapa', async () => {
    const { fixture, el } = await render();

    button(el, 'Pular').click();
    fixture.detectChanges();
    button(el, 'Voltar').click();
    fixture.detectChanges();

    expect(el.querySelector('.dialog')).toBeNull();
    expect(el.querySelector('h1')?.textContent).toContain('PontoMais');
  });

  it('pular tudo grava a configuração como concluída e libera a tela principal', async () => {
    const { fixture, el } = await render();
    const onboarding = TestBed.inject(OnboardingService);

    button(el, 'Pular tudo').click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.dialog-foot .btn-primary')!.click();
    await fixture.whenStable();

    expect(saved.onboardingState).toBe('done');
    expect(onboarding.status()).toBe('off');
  });

  it('o último passo conclui o assistente', async () => {
    const { fixture, el } = await render();

    button(el, 'Pular').click();
    fixture.detectChanges();
    button(el, 'Pular mesmo assim').click();
    fixture.detectChanges();
    button(el, 'Continuar').click();
    fixture.detectChanges();
    button(el, 'Continuar').click();
    fixture.detectChanges();

    expect(button(el, 'Começar a usar')).toBeDefined();
    button(el, 'Começar a usar').click();
    await fixture.whenStable();

    expect(saved.onboardingState).toBe('done');
  });

  it('sem conta, continuar fica desabilitado até conectar', async () => {
    const { el } = await render();
    expect(button(el, 'Continuar').disabled).toBe(true);
    expect(button(el, 'Pular').disabled).toBe(false);
  });

  it('pular uma etapa opcional avança direto, sem confirmação', async () => {
    const { fixture, el } = await render();

    button(el, 'Pular').click();
    fixture.detectChanges();
    button(el, 'Pular mesmo assim').click();
    fixture.detectChanges();
    expect(el.querySelector('h1')?.textContent).toContain('expediente acabar');

    button(el, 'Pular').click();
    fixture.detectChanges();
    expect(el.querySelector('.dialog')).toBeNull();
    expect(el.querySelector('h1')?.textContent).toContain('aplicativo');
  });

  it('esc abre o pular tudo, e esc de novo fecha sem pular', async () => {
    const { fixture, el } = await render();
    const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    esc();
    fixture.detectChanges();
    expect(el.querySelector('.dialog h2')?.textContent).toContain('Pular a configuração inicial?');

    esc();
    fixture.detectChanges();
    expect(el.querySelector('.dialog')).toBeNull();
    expect(saved.onboardingState).toBe('pending');
  });

  it('esc seguido de confirmar pula tudo', async () => {
    const { fixture, el } = await render();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.dialog-foot .btn-primary')!.click();
    await fixture.whenStable();

    expect(saved.onboardingState).toBe('done');
  });

  it('a barra acompanha a etapa atual e fica cheia na última', async () => {
    const { fixture, el } = await render();
    const progress = () => el.querySelector('.bar')!.getAttribute('aria-valuenow');
    const fill = () => (el.querySelector('.bar span') as HTMLElement).style.transform;

    expect(progress()).toBe('1');
    expect(fill()).toBe('scaleX(0.25)');

    button(el, 'Pular').click();
    fixture.detectChanges();
    button(el, 'Pular mesmo assim').click();
    fixture.detectChanges();
    button(el, 'Pular').click();
    fixture.detectChanges();
    button(el, 'Pular').click();
    fixture.detectChanges();

    expect(el.querySelector('.eyebrow')?.textContent).toContain('etapa 4 de 4');
    expect(progress()).toBe('4');
    expect(fill()).toBe('scaleX(1)');
  });

  it('retomar com a sessão perdida volta para a etapa da conta em vez de "etapa 0"', async () => {
    saved = { ...saved, isPontomaisLoggedIn: true, pontomaisLogin: 'a@x.com' };
    await TestBed.inject(SettingsStore).load();

    const { fixture, el } = await render();
    await new Promise(resolve => setTimeout(resolve));
    fixture.detectChanges();

    expect(saved.isPontomaisLoggedIn).toBe(false);
    expect(el.querySelector('.eyebrow')?.textContent).toContain('etapa 1 de 4');
    expect(el.querySelector('h1')?.textContent).toContain('PontoMais');
    expect(button(el, 'Continuar').disabled).toBe(true);
  });

  it('a desvinculação feita pelo Rust durante o assistente atualiza a etapa da conta', async () => {
    session = 'connected';
    saved = { ...saved, isPontomaisLoggedIn: true, pontomaisLogin: 'a@x.com' };
    await TestBed.inject(SettingsStore).load();
    const { fixture, el } = await render();
    expect(el.querySelector('.eyebrow')?.textContent).toContain('de 5');

    session = 'signedOut';
    await emit('session-expired');
    await new Promise(resolve => setTimeout(resolve, 10));
    fixture.detectChanges();

    expect(el.querySelector('.eyebrow')?.textContent).toContain('etapa 1 de 4');
  });

  it('a confirmação de pular recebe o foco ao abrir', async () => {
    const { fixture, el } = await render();

    button(el, 'Pular').click();
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve));

    expect(document.activeElement).toBe(el.querySelector('.dialog-foot .btn-primary'));
  });

  it('avisa o Rust que a janela pode aparecer depois do primeiro render', async () => {
    await render();
    expect(calls).toContain('main_window_ready');
  });
});
