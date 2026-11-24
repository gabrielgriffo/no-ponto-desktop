import { Injectable, signal } from '@angular/core';
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
  return (previous === 'andamento' || previous === 'pausado') && current === 'extra';
}

export function isWorkdayReopened(
  previous: JourneyState | null,
  current: JourneyState,
  workedMinutes: number,
  targetMinutes: number
): boolean {
  return previous === 'extra' && (current === 'andamento' || current === 'pausado') && workedMinutes < targetMinutes;
}

export function closedDayState(
  cardCount: number,
  workedMinutes: number,
  journeyMinutes: number
): 'terminou' | 'pausado' | null {
  if (cardCount === 0 || cardCount % 2 !== 0) return null;
  return workedMinutes >= journeyMinutes ? 'terminou' : 'pausado';
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

@Injectable({ providedIn: 'root' })
export class AlarmService {
  private readonly visible = signal(false);
  private readonly journey = signal(0);
  private readonly snoozed = signal<Date | null>(null);

  readonly isVisible = this.visible.asReadonly();
  readonly journeyMinutes = this.journey.asReadonly();
  readonly snoozedUntil = this.snoozed.asReadonly();

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
    this.journey.set(options.journeyMinutes);
    this.visible.set(true);
    audio.play().catch(() => this.silence());
    invoke('focus_main_window').catch(() => {});
  }

  snooze(): void {
    const options = this.lastOptions;
    this.dismiss();
    if (!options) return;
    this.snoozed.set(new Date(Date.now() + SNOOZE_MINUTES * 60_000));
    this.snoozeTimer = setTimeout(() => this.ring(options), SNOOZE_MINUTES * 60_000);
  }

  dismiss(): void {
    clearTimeout(this.snoozeTimer);
    this.snoozeTimer = undefined;
    this.snoozed.set(null);
    this.silence();
    this.visible.set(false);
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
