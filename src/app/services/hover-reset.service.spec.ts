import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HoverResetService } from './hover-reset.service';

describe('HoverResetService', () => {
  let service: HoverResetService;
  let button: HTMLButtonElement;
  let clicks: number;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(HoverResetService);
    clicks = 0;
    button = document.createElement('button');
    button.addEventListener('click', () => clicks++);
    document.body.appendChild(button);
    document.elementFromPoint = vi.fn(() => button);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const shield = () => document.querySelector('.hover-reset-shield');

  it('o primeiro clique sem mover o ponteiro chega ao botão embaixo do escudo', () => {
    service.arm();
    shield()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
    button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));

    expect(shield()).toBeNull();
    expect(clicks).toBe(1);
  });

  it('soltar fora do elemento não dispara clique', () => {
    service.arm();
    shield()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));

    expect(clicks).toBe(0);
  });

  it('mover o ponteiro só remove o escudo', () => {
    service.arm();
    window.dispatchEvent(new MouseEvent('pointermove'));

    expect(shield()).toBeNull();
    expect(clicks).toBe(0);
  });
});
