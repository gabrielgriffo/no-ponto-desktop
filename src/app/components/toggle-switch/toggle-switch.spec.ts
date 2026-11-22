import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ToggleSwitch } from './toggle-switch';

@Component({
  imports: [ToggleSwitch],
  template: `<app-toggle-switch [checked]="saved()" (checkedChange)="onRequest($event)" />`,
})
class Host {
  readonly saved = signal(false);
  accept = true;
  requests: boolean[] = [];

  onRequest(value: boolean): void {
    this.requests.push(value);
    if (this.accept) this.saved.set(value);
  }
}

describe('ToggleSwitch', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));

  async function render(accept: boolean) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.accept = accept;
    await fixture.whenStable();
    const checkbox: HTMLInputElement = fixture.nativeElement.querySelector('input[type="checkbox"]');
    return { fixture, checkbox };
  }

  it('acompanha o valor quando o pai aceita a mudança', async () => {
    const { fixture, checkbox } = await render(true);

    checkbox.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.requests).toEqual([true]);
    expect(checkbox.checked).toBe(true);
  });

  it('volta à posição salva quando o pai recusa a mudança', async () => {
    const { fixture, checkbox } = await render(false);

    checkbox.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.requests).toEqual([true]);
    expect(checkbox.checked).toBe(false);
  });
});
