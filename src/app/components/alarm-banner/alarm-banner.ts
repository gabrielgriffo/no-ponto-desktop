import { Component } from '@angular/core';
import { AlarmService, SNOOZE_MINUTES, WORKDAY_END_TITLE, workdayEndMessage } from '../../services/alarm.service';

@Component({
  selector: 'app-alarm-banner',
  templateUrl: './alarm-banner.html',
  styleUrl: './alarm-banner.css',
})
export class AlarmBanner {
  readonly snoozeMinutes = SNOOZE_MINUTES;
  readonly title = WORKDAY_END_TITLE;

  constructor(public alarmService: AlarmService) {}

  get message(): string {
    return workdayEndMessage(this.alarmService.journeyMinutes);
  }
}
