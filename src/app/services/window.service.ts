import { Injectable } from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { HoverResetService } from './hover-reset.service';

@Injectable({
  providedIn: 'root'
})
export class WindowService {
  constructor(private hoverReset: HoverResetService) {}

  async minimize(): Promise<void> {
    this.hoverReset.arm();
    const window = await getCurrentWindow();
    await window.minimize();
  }

  async close(): Promise<void> {
    this.hoverReset.arm();
    const window = await getCurrentWindow();
    await window.close();
  }
}
