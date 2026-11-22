import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ToastService, ToastMessage } from '../../services/toast.service';

interface ToastItem extends ToastMessage {
  id: number;
  isExiting: boolean;
}

interface ToastView extends ToastItem {
  zIndex: number;
  bottom: number;
  blur?: string;
  scale?: number;
}

const BASE_Z_INDEX = 9999999;
const MAX_TOASTS = 3;
const EXIT_ANIMATION_MS = 300;

@Component({
  selector: 'app-toast',
  templateUrl: './toast.html',
  styleUrl: './toast.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Toast {
  private readonly toasts = signal<ToastItem[]>([]);
  private nextId = 1;

  protected readonly views = computed<ToastView[]>(() => {
    const toasts = this.toasts();
    return toasts.map((toast, index) => {
      const view: ToastView = { ...toast, zIndex: BASE_Z_INDEX + index, bottom: 20 };
      if (toast.isExiting) return view;

      const above = toasts.slice(index + 1).filter(t => !t.isExiting).length;
      return { ...view, bottom: 20 + above * 10, blur: `blur(${above * 0.4}px)`, scale: 1 - above * 0.05 };
    });
  });

  constructor() {
    inject(ToastService).toast$
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(toast => this.show(toast));
  }

  protected close(id: number): void {
    const toast = this.toasts().find(t => t.id === id);
    if (!toast || toast.isExiting) return;

    this.setExiting(id);
    setTimeout(() => this.remove(id), EXIT_ANIMATION_MS);
  }

  private show(toast: ToastMessage): void {
    const active = this.toasts().filter(t => !t.isExiting);
    for (const oldest of active.slice(0, Math.max(0, active.length - MAX_TOASTS + 1))) {
      this.remove(oldest.id);
    }

    const item: ToastItem = { ...toast, id: this.nextId++, isExiting: false };
    this.toasts.update(toasts => [...toasts, item]);
    setTimeout(() => this.close(item.id), toast.duration || 3000);
  }

  private setExiting(id: number): void {
    this.toasts.update(toasts => toasts.map(t => (t.id === id ? { ...t, isExiting: true } : t)));
  }

  private remove(id: number): void {
    this.toasts.update(toasts => toasts.filter(t => t.id !== id));
  }
}
