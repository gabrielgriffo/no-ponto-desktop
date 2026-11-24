import { Injectable } from '@angular/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

@Injectable({
  providedIn: 'root'
})
export class HoverResetService {
  private shield: HTMLDivElement | null = null;
  private readonly release = () => this.disarm();
  private readonly releaseAndForward = (event: PointerEvent) => {
    this.disarm();
    const target = document.elementFromPoint?.(event.clientX, event.clientY);
    if (!(target instanceof HTMLElement)) return;

    window.addEventListener(
      'pointerup',
      up => {
        if (!target.contains(up.target as Node)) return;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) target.focus();
        else target.click();
      },
      { once: true, capture: true }
    );
  };

  async init(): Promise<void> {
    await listen('main-window-hidden', () => this.arm());
    await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) this.arm();
    });
  }

  arm(): void {
    if (this.shield) return;
    const shield = document.createElement('div');
    shield.className = 'hover-reset-shield';
    document.body.appendChild(shield);
    this.shield = shield;
    window.addEventListener('pointermove', this.release, { capture: true });
    window.addEventListener('pointerdown', this.releaseAndForward, { capture: true });
  }

  private disarm(): void {
    window.removeEventListener('pointermove', this.release, { capture: true });
    window.removeEventListener('pointerdown', this.releaseAndForward, { capture: true });
    this.shield?.remove();
    this.shield = null;
  }
}
