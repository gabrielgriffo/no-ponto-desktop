import { Component, Input, Output, EventEmitter, OnDestroy } from '@angular/core';
import { ToggleSwitch } from '../../../../components/toggle-switch/toggle-switch';
import { CustomSelect } from '../../../../components/custom-select/custom-select';
import { RangeSlider } from '../../../../components/range-slider/range-slider';
import {
  ALARM_DURATION_OPTIONS,
  ALARM_MODE_OPTIONS,
  ALARM_SOUND_OPTIONS,
  AppSettings,
} from '../../settings.model';

@Component({
  selector: 'app-alerts-settings',
  imports: [ToggleSwitch, CustomSelect, RangeSlider],
  templateUrl: './alerts-settings.html',
})
export class AlertsSettingsComponent implements OnDestroy {
  @Input() settings!: AppSettings;
  @Output() settingsChange = new EventEmitter<void>();

  readonly soundOptions = ALARM_SOUND_OPTIONS;
  readonly modeOptions = ALARM_MODE_OPTIONS;
  readonly durationOptions = ALARM_DURATION_OPTIONS;

  isPreviewing = false;

  private preview: HTMLAudioElement | null = null;

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
