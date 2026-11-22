import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { CustomSelect } from '../../../../components/custom-select/custom-select';
import { TimeInputDirective } from '../../../../directives/time-input.directive';
import { TimeUtilsService } from '../../../../services/time-utils.service';
import {
  AppSettings,
  BREAK_OPTIONS,
  CUSTOM_DURATION,
  SettingsPatch,
  WORKDAY_OPTIONS,
  durationToTimeString,
  timeStringToDuration,
} from '../../settings.model';

const optionFor = (options: { value: unknown }[], minutes: number) =>
  options.some(option => option.value === minutes) ? minutes : CUSTOM_DURATION;

@Component({
  selector: 'app-workday-settings',
  imports: [CustomSelect, TimeInputDirective],
  templateUrl: './workday-settings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkdaySettingsComponent implements OnInit {
  readonly settings = input.required<AppSettings>();
  readonly patch = output<SettingsPatch>();

  protected readonly workdayOptions = WORKDAY_OPTIONS;
  protected readonly breakOptions = BREAK_OPTIONS;
  protected readonly customDuration = CUSTOM_DURATION;

  private readonly timeUtils = inject(TimeUtilsService);

  protected readonly selectedWorkday = signal(CUSTOM_DURATION);
  protected readonly customWorkday = signal('');
  protected readonly selectedBreak = signal(CUSTOM_DURATION);
  protected readonly customBreak = signal('');

  ngOnInit(): void {
    const { expectedWorkdayMinutes, defaultBreakMinutes } = this.settings();
    this.selectedWorkday.set(optionFor(WORKDAY_OPTIONS, expectedWorkdayMinutes));
    this.customWorkday.set(durationToTimeString(expectedWorkdayMinutes));
    this.selectedBreak.set(optionFor(BREAK_OPTIONS, defaultBreakMinutes));
    this.customBreak.set(durationToTimeString(defaultBreakMinutes));
  }

  protected onWorkdaySelect(minutes: number): void {
    this.selectedWorkday.set(minutes);
    // "Personalizado" não é uma duração: só revela o campo, mantendo o valor
    // salvo até que o usuário digite um novo.
    if (minutes === CUSTOM_DURATION) return;

    this.customWorkday.set(durationToTimeString(minutes));
    this.patch.emit({ expectedWorkdayMinutes: minutes });
  }

  protected onCustomWorkday(value: string): void {
    this.customWorkday.set(value);

    // Entrada pela metade ("08:") não vale como jornada — nada é salvo até o
    // valor fazer sentido, e o anterior continua valendo enquanto isso.
    const minutes = this.parseDuration(value);
    if (minutes !== null) this.patch.emit({ expectedWorkdayMinutes: minutes });
  }

  protected onBreakSelect(minutes: number): void {
    this.selectedBreak.set(minutes);
    if (minutes === CUSTOM_DURATION) return;

    this.customBreak.set(durationToTimeString(minutes));
    this.patch.emit({ defaultBreakMinutes: minutes });
  }

  protected onCustomBreak(value: string): void {
    this.customBreak.set(value);

    const minutes = this.parseDuration(value);
    if (minutes !== null) this.patch.emit({ defaultBreakMinutes: minutes });
  }

  private parseDuration(value: string): number | null {
    return timeStringToDuration(this.timeUtils.formatTimeInput(value));
  }
}
