import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AlarmService, SNOOZE_MINUTES, WORKDAY_END_TITLE, workdayEndMessage } from '../../services/alarm.service';

@Component({
  selector: 'app-alarm-banner',
  templateUrl: './alarm-banner.html',
  styleUrl: './alarm-banner.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlarmBanner {
  protected readonly alarmService = inject(AlarmService);
  protected readonly snoozeMinutes = SNOOZE_MINUTES;
  protected readonly title = WORKDAY_END_TITLE;
  protected readonly message = computed(() => workdayEndMessage(this.alarmService.journeyMinutes()));
}
