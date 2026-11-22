import { Pipe, PipeTransform } from '@angular/core';
import { TimeObject } from '../models/time-object';

const pad = (value: number) => value.toString().padStart(2, '0');

@Pipe({ name: 'timeFormat' })
export class TimeFormatPipe implements PipeTransform {
  transform(time: TimeObject | null | undefined, format: 'duration' | 'clock' = 'duration'): string {
    if (!time) return '';
    return format === 'clock'
      ? `${pad(time.hours)}:${pad(time.minutes)}`
      : `${pad(time.hours)}h ${pad(time.minutes)}m`;
  }
}
