import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CustomSelect } from '../../../../components/custom-select/custom-select';
import { TimeInputDirective } from '../../../../directives/time-input.directive';
import {
  AppSettings,
  BREAK_OPTIONS,
  CUSTOM_DURATION,
  WORKDAY_OPTIONS,
  durationToTimeString,
  timeStringToDuration,
} from '../../settings.model';

@Component({
  selector: 'app-workday-settings',
  imports: [CustomSelect, TimeInputDirective],
  templateUrl: './workday-settings.html',
})
export class WorkdaySettingsComponent implements OnInit {
  @Input() settings!: AppSettings;
  @Output() settingsChange = new EventEmitter<void>();

  readonly workdayOptions = WORKDAY_OPTIONS;
  readonly breakOptions = BREAK_OPTIONS;
  readonly customDuration = CUSTOM_DURATION;

  selectedWorkday = CUSTOM_DURATION;
  customWorkday = '';

  selectedBreak = CUSTOM_DURATION;
  customBreak = '';

  ngOnInit(): void {
    const workday = this.settings.expectedWorkdayMinutes;
    this.selectedWorkday = WORKDAY_OPTIONS.some(opt => opt.value === workday)
      ? workday
      : CUSTOM_DURATION;
    this.customWorkday = durationToTimeString(workday);

    const breakMinutes = this.settings.defaultBreakMinutes;
    this.selectedBreak = BREAK_OPTIONS.some(opt => opt.value === breakMinutes)
      ? breakMinutes
      : CUSTOM_DURATION;
    this.customBreak = durationToTimeString(breakMinutes);
  }

  onWorkdaySelect(): void {
    // "Personalizado" não é uma duração: só revela o campo, mantendo o valor
    // salvo até que o usuário digite um novo.
    if (this.selectedWorkday === CUSTOM_DURATION) return;

    this.settings.expectedWorkdayMinutes = this.selectedWorkday;
    this.customWorkday = durationToTimeString(this.selectedWorkday);
    this.settingsChange.emit();
  }

  onCustomWorkday(value: string): void {
    this.customWorkday = value;

    // Entrada pela metade ("08:") não vale como jornada — nada é salvo até o
    // valor fazer sentido, e o anterior continua valendo enquanto isso.
    const minutes = timeStringToDuration(value);
    if (minutes === null) return;

    this.settings.expectedWorkdayMinutes = minutes;
    this.settingsChange.emit();
  }

  onBreakSelect(): void {
    if (this.selectedBreak === CUSTOM_DURATION) return;

    this.settings.defaultBreakMinutes = this.selectedBreak;
    this.customBreak = durationToTimeString(this.selectedBreak);
    this.settingsChange.emit();
  }

  onCustomBreak(value: string): void {
    this.customBreak = value;

    const minutes = timeStringToDuration(value);
    if (minutes === null) return;

    this.settings.defaultBreakMinutes = minutes;
    this.settingsChange.emit();
  }
}
