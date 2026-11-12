import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { AlarmMode } from '../pages/settings-modal/settings.model';

export type JourneyState = 'andamento' | 'pausado' | 'terminou' | 'extra';

export interface AlarmOptions {
  sound: string;
  volume: number;
  mode: AlarmMode;
  durationSeconds: number;
  journeyMinutes: number;
}

export const SNOOZE_MINUTES = 10;

export function shouldRingAlarm(previous: JourneyState | null, current: JourneyState): boolean {
  return previous === 'andamento' && current === 'extra';
}

export function formatJourney(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${String(rest).padStart(2, '0')}`;
}

export const WORKDAY_END_TITLE = 'Expediente concluído';

export function workdayEndMessage(journeyMinutes: number): string {
  return `Você completou ${formatJourney(journeyMinutes)}. Já pode bater o ponto.`;
}

@Injectable({
  providedIn: 'root'
})
export class AlarmService {
  isVisible = false;
  journeyMinutes = 0;

  private audio: HTMLAudioElement | null = null;
  private stopTimer?: ReturnType<typeof setTimeout>;
  private snoozeTimer?: ReturnType<typeof setTimeout>;
  private lastOptions: AlarmOptions | null = null;

  ring(options: AlarmOptions): void {
    this.dismiss();

    const audio = new Audio(`assets/sounds/${options.sound}.wav`);
    audio.volume = Math.min(1, Math.max(0, options.volume / 100));
    audio.loop = options.mode === 'continuous';
    audio.onended = () => this.silence();

    if (audio.loop) {
      this.stopTimer = setTimeout(() => this.silence(), options.durationSeconds * 1000);
    }

    this.audio = audio;
    this.lastOptions = options;
    this.journeyMinutes = options.journeyMinutes;
    this.isVisible = true;
    audio.play().catch(() => this.silence());
    invoke('focus_main_window').catch(() => {});
  }

  snooze(): void {
    const options = this.lastOptions;
    this.dismiss();
    if (!options) return;
    this.snoozeTimer = setTimeout(() => this.ring(options), SNOOZE_MINUTES * 60_000);
  }

  dismiss(): void {
    clearTimeout(this.snoozeTimer);
    this.snoozeTimer = undefined;
    this.silence();
    this.isVisible = false;
  }

  private silence(): void {
    clearTimeout(this.stopTimer);
    this.stopTimer = undefined;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.pause();
      this.audio = null;
    }
  }
}
