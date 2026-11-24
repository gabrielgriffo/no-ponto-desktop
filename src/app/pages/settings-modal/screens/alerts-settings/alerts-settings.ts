import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, input, linkedSignal, output, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { ToggleSwitch } from '../../../../components/toggle-switch/toggle-switch';
import { CustomSelect } from '../../../../components/custom-select/custom-select';
import { RangeSlider } from '../../../../components/range-slider/range-slider';
import {
  ALARM_DURATION_OPTIONS,
  ALARM_MODE_OPTIONS,
  ALARM_SOUND_OPTIONS,
  AppSettings,
  SettingsPatch,
} from '../../settings.model';
import { alarmSoundUrl } from '../../../../services/alarm.service';

type NotificationStatus =
  | 'enabled'
  | 'disabledForUser'
  | 'disabledForApplication'
  | 'disabledByPolicy'
  | 'unknown';

const NOTIFICATION_WARNINGS: Partial<Record<NotificationStatus, string>> = {
  disabledForUser: 'As notificações estão desativadas no sistema',
  disabledForApplication: 'As notificações do No Ponto estão desativadas no sistema',
  disabledByPolicy: 'As notificações estão bloqueadas pela política da sua organização',
};

@Component({
  selector: 'app-alerts-settings',
  imports: [ToggleSwitch, CustomSelect, RangeSlider],
  templateUrl: './alerts-settings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:focus)': 'refreshNotificationStatus()' },
})
export class AlertsSettingsComponent implements OnInit, OnDestroy {
  readonly settings = input.required<AppSettings>();
  readonly patch = output<SettingsPatch>();

  protected readonly soundOptions = ALARM_SOUND_OPTIONS;
  protected readonly modeOptions = ALARM_MODE_OPTIONS;
  protected readonly durationOptions = ALARM_DURATION_OPTIONS;

  protected readonly volume = linkedSignal(() => this.settings().alarmVolume);
  protected readonly isPreviewing = signal(false);
  private readonly notificationStatus = signal<NotificationStatus>('unknown');

  protected readonly notificationWarning = computed(() => NOTIFICATION_WARNINGS[this.notificationStatus()] ?? null);
  protected readonly canOpenNotificationSettings = computed(() => this.notificationStatus() !== 'disabledByPolicy');

  private preview: HTMLAudioElement | null = null;

  ngOnInit(): void {
    this.refreshNotificationStatus();
  }

  ngOnDestroy(): void {
    this.stopPreview();
  }

  protected onOpenNotificationSettings(): void {
    invoke('open_notification_settings').catch(() => {});
  }

  protected onAlarmToggle(enabled: boolean): void {
    if (!enabled) this.stopPreview();
    this.patch.emit({ alarmEnabled: enabled });
  }

  protected onVolumeInput(volume: number): void {
    this.volume.set(volume);
    if (this.preview) this.preview.volume = volume / 100;
  }

  protected onVolumeCommit(volume: number): void {
    this.patch.emit({ alarmVolume: volume });
  }

  protected onSoundChange(sound: string): void {
    this.stopPreview();
    this.patch.emit({ alarmSound: sound });
  }

  protected onTogglePreview(): void {
    if (this.isPreviewing()) {
      this.stopPreview();
      return;
    }

    const audio = new Audio(alarmSoundUrl(this.settings().alarmSound));
    audio.volume = this.volume() / 100;
    audio.onended = () => this.stopPreview();

    this.preview = audio;
    this.isPreviewing.set(true);

    audio.play().catch(() => this.stopPreview());
  }

  protected async refreshNotificationStatus(): Promise<void> {
    try {
      this.notificationStatus.set(await invoke<NotificationStatus>('notification_status'));
    } catch {
      this.notificationStatus.set('unknown');
    }
  }

  private stopPreview(): void {
    if (this.preview) {
      this.preview.pause();
      this.preview.onended = null;
      this.preview = null;
    }
    this.isPreviewing.set(false);
  }
}
