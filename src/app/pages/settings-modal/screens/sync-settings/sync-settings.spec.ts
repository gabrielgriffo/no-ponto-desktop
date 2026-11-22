import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { SyncSettingsComponent } from './sync-settings';
import { DEFAULT_SETTINGS, SettingsPatch } from '../../settings.model';

describe('SyncSettingsComponent', () => {
  let patches: SettingsPatch[];

  async function render(settings = DEFAULT_SETTINGS) {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(SyncSettingsComponent);
    fixture.componentRef.setInput('settings', settings);
    fixture.componentInstance.patch.subscribe(patch => patches.push(patch));
    await fixture.whenStable();
    return fixture;
  }

  function toggles(element: HTMLElement): HTMLInputElement[] {
    return Array.from(element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  }

  beforeEach(() => (patches = []));

  it('ligar a sincronização inteligente desliga a automática no mesmo patch', async () => {
    const fixture = await render({ ...DEFAULT_SETTINGS, autoImportEnabled: true });
    const smart = toggles(fixture.nativeElement).at(-1)!;

    smart.checked = true;
    smart.dispatchEvent(new Event('change'));

    expect(patches).toEqual([{ smartSyncEnabled: true, autoImportEnabled: false }]);
  });

  it('o seletor de intervalo só aparece com a sincronização automática ligada', async () => {
    const off = await render();
    expect(off.nativeElement.querySelector('app-custom-select')).toBeNull();

    off.componentRef.setInput('settings', { ...DEFAULT_SETTINGS, autoImportEnabled: true });
    await off.whenStable();
    expect(off.nativeElement.querySelector('app-custom-select')).not.toBeNull();
  });
});
