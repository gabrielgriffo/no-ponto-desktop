import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Toast } from './toast';
import { ToastService } from '../../services/toast.service';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });
  afterEach(() => vi.useRealTimers());

  function messages(element: HTMLElement): string[] {
    return Array.from(element.querySelectorAll('.toast-message')).map(node => node.textContent ?? '');
  }

  it('renderiza sem zone.js, limita a três e some depois da duração', async () => {
    const fixture = TestBed.createComponent(Toast);
    const service = TestBed.inject(ToastService);
    fixture.detectChanges();

    ['um', 'dois', 'três', 'quatro'].forEach(message => service.info(message, 1000));
    fixture.detectChanges();
    expect(messages(fixture.nativeElement)).toEqual(['dois', 'três', 'quatro']);

    vi.advanceTimersByTime(1000 + 300);
    fixture.detectChanges();
    expect(messages(fixture.nativeElement)).toEqual([]);
  });
});
