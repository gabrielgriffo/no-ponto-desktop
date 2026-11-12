import { Component, Input, Output, EventEmitter, OnDestroy, OnInit } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { ToggleSwitch } from '../../../../components/toggle-switch/toggle-switch';
import { CustomSelect } from '../../../../components/custom-select/custom-select';
import { RangeSlider } from '../../../../components/range-slider/range-slider';
import {
  ALARM_DURATION_OPTIONS,
  ALARM_MODE_OPTIONS,
  ALARM_SOUND_OPTIONS,
  AppSettings,
} from '../../settings.model';

type NotificationStatus =
  | 'enabled'
  | 'disabledForUser'
  | 'disabledForApplication'
  | 'disabledByPolicy'
  | 'unknown';

@Component({
  selector: 'app-alerts-settings',
  imports: [ToggleSwitch, CustomSelect, RangeSlider],
  templateUrl: './alerts-settings.html',
})
export class AlertsSettingsComponent implements OnInit, OnDestroy {
  @Input() settings!: AppSettings;
  @Output() settingsChange = new EventEmitter<void>();

  readonly soundOptions = ALARM_SOUND_OPTIONS;
  readonly modeOptions = ALARM_MODE_OPTIONS;
  readonly durationOptions = ALARM_DURATION_OPTIONS;

  isPreviewing = false;
  notificationStatus: NotificationStatus = 'unknown';

  private preview: HTMLAudioElement | null = null;
  private readonly onWindowFocus = () => this.refreshNotificationStatus();

  ngOnInit(): void {
    this.refreshNotificationStatus();
    window.addEventListener('focus', this.onWindowFocus);
  }

  get notificationWarning(): string | null {
    switch (this.notificationStatus) {
      case 'disabledForUser':
        return 'As notificações estão desativadas no Windows.';
      case 'disabledForApplication':
        return 'As notificações do No Ponto estão desativadas no Windows.';
      case 'disabledByPolicy':
        return 'As notificações foram bloqueadas pela política da sua organização.';
      default:
        return null;
    }
  }

  get canOpenNotificationSettings(): boolean {
    return this.notificationStatus !== 'disabledByPolicy';
  }

  onOpenNotificationSettings(): void {
    invoke('open_notification_settings').catch(() => {});
  }

  onChange(): void {
    this.settingsChange.emit();
  }

  onAlarmToggle(enabled: boolean): void {
    this.settings.alarmEnabled = enabled;
    if (!enabled) this.stopPreview();
    this.onChange();
  }

  onVolumeInput(volume: number): void {
    this.settings.alarmVolume = volume;
    if (this.preview) this.preview.volume = volume / 100;
  }

  onVolumeCommit(): void {
    this.onChange();
  }

  onSoundChange(): void {
    this.stopPreview();
    this.onChange();
  }

  onTogglePreview(): void {
    if (this.isPreviewing) {
      this.stopPreview();
      return;
    }

    const audio = new Audio(`assets/sounds/${this.settings.alarmSound}.wav`);
    audio.volume = this.settings.alarmVolume / 100;
    audio.onended = () => this.stopPreview();

    this.preview = audio;
    this.isPreviewing = true;

    audio.play().catch(() => this.stopPreview());
  }

  ngOnDestroy(): void {
    this.stopPreview();
    window.removeEventListener('focus', this.onWindowFocus);
  }

  private async refreshNotificationStatus(): Promise<void> {
    try {
      this.notificationStatus = await invoke<NotificationStatus>('notification_status');
    } catch {
      this.notificationStatus = 'unknown';
    }
  }

  private stopPreview(): void {
    if (this.preview) {
      this.preview.pause();
      this.preview.onended = null;
      this.preview = null;
    }
    this.isPreviewing = false;
  }
}
