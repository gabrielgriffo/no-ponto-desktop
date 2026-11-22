import { Injectable, inject } from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { HoverResetService } from './hover-reset.service';

@Injectable({ providedIn: 'root' })
export class WindowService {
  private readonly hoverReset = inject(HoverResetService);

  async minimize(): Promise<void> {
    this.hoverReset.arm();
    await getCurrentWindow().minimize();
  }

  async close(): Promise<void> {
    this.hoverReset.arm();
    await getCurrentWindow().close();
  }
}
