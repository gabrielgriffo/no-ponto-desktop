import { TimeCard, WorkDaysResponse } from '../services/pontomais.service';

function cardMinutes(card: TimeCard): number {
  const [hours, minutes] = card.time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function validTimeCards(workDay: WorkDaysResponse | null): TimeCard[] {
  return (workDay?.work_days?.[0]?.time_cards ?? [])
    .filter(card => !card.disabled)
    .sort((a, b) => cardMinutes(a) - cardMinutes(b));
}

export function hasTimeCards(workDay: WorkDaysResponse | null): boolean {
  return validTimeCards(workDay).length > 0;
}

/**
 * Data de hoje no fuso local, no formato aceito pela API (YYYY-MM-DD).
 * Não usar `toISOString()`: ele converte para UTC e, em UTC-3, a partir das 21h
 * já retorna o dia seguinte — divergindo do `Local::now()` usado no auto-sync.
 */
export function todayLocalDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function isTodayLocal(date: string, now: Date = new Date()): boolean {
  return date === todayLocalDate(now);
}
