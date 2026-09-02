import { SelectOption } from '../../components/custom-select/custom-select';

/// Espelha a struct `ExternalApp` do Rust (`src-tauri/src/external_app.rs`).
export interface ExternalApp {
  path: string;
  name: string;
  exec: string;
  args: string[];
}

export type UpdateResult = '' | 'up-to-date' | 'available' | 'error';

export type AlarmMode = 'single' | 'continuous';

/// Espelha a struct `Settings` do Rust (`src-tauri/src/settings.rs`).
export interface AppSettings {
  smartSyncEnabled: boolean;
  autoImportEnabled: boolean;
  autoImportInterval: number;
  importOnStartupEnabled: boolean;
  alarmEnabled: boolean;
  alarmSound: string;
  alarmVolume: number;
  alarmMode: AlarmMode;
  alarmDurationSeconds: number;
  notificationEnabled: boolean;
  autostartEnabled: boolean;
  startMinimizedEnabled: boolean;
  autoCloseWithoutWorkdayEnabled: boolean;
  autoCloseWithoutWorkdayTime: number;
  externalAppAutostartEnabled: boolean;
  externalApp: ExternalApp | null;
  expectedWorkdayMinutes: number;
  defaultBreakMinutes: number;
  lastUpdateCheck: string;
  lastUpdateResult: UpdateResult;
  lastUpdateVersion: string;
  pontomaisLogin: string;
  isPontomaisLoggedIn: boolean;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  if (!candidate || !current) return false;

  const parse = (value: string) =>
    value.split('.').map(part => Number.parseInt(part, 10) || 0);

  const left = parse(candidate);
  const right = parse(current);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a !== b) return a > b;
  }

  return false;
}

export const DEFAULT_EXPECTED_WORKDAY_MINUTES = 480;
export const DEFAULT_BREAK_MINUTES = 60;

export const DEFAULT_ALARM_SOUND = 'classico';
export const DEFAULT_ALARM_VOLUME = 70;
export const DEFAULT_ALARM_MODE: AlarmMode = 'single';
export const DEFAULT_ALARM_DURATION_SECONDS = 30;

export const DEFAULT_AUTO_CLOSE_TIME = 660;

export const ALARM_SOUND_OPTIONS: SelectOption[] = [
  { value: 'classico', label: 'Clássico' },
  { value: 'suave', label: 'Suave' },
  { value: 'digital', label: 'Digital' },
  { value: 'sino', label: 'Sino' },
];

export const ALARM_MODE_OPTIONS: SelectOption[] = [
  { value: 'single', label: 'Tocar uma vez' },
  { value: 'continuous', label: 'Tocar continuamente' },
];

export const ALARM_DURATION_OPTIONS: SelectOption[] = [
  { value: 15, label: '15 segundos' },
  { value: 30, label: '30 segundos' },
  { value: 60, label: '1 minuto' },
  { value: 120, label: '2 minutos' },
];

export const AUTO_CLOSE_TIME_OPTIONS: SelectOption[] = [
  { value: 540, label: '09:00' },
  { value: 600, label: '10:00' },
  { value: 660, label: '11:00' },
  { value: 720, label: '12:00' },
  { value: 840, label: '14:00' },
];

export const CUSTOM_DURATION = -1;

export const WORKDAY_OPTIONS: SelectOption[] = [
  { label: '6 horas', value: 360 },
  { label: '7 horas e 20 minutos', value: 440 },
  { label: '8 horas', value: 480 },
  { label: '8 horas e 48 minutos', value: 528 },
  { label: 'Personalizado…', value: CUSTOM_DURATION },
];

export const BREAK_OPTIONS: SelectOption[] = [
  { label: 'Sem intervalo', value: 0 },
  { label: '30 minutos', value: 30 },
  { label: '1 hora', value: 60 },
  { label: '1 hora e 30 minutos', value: 90 },
  { label: '2 horas', value: 120 },
  { label: 'Personalizado…', value: CUSTOM_DURATION },
];

export const INTERVAL_OPTIONS: SelectOption[] = [
  { value: 10, label: '10 minutos' },
  { value: 15, label: '15 minutos' },
  { value: 30, label: '30 minutos' },
  { value: 60, label: '1 hora' },
];

/** `480` → `"8h"`, `528` → `"8h48"`. Formato curto, para caber na linha da raiz. */
export function formatWorkday(minutes: number): string {
  const total = minutes > 0 ? minutes : DEFAULT_EXPECTED_WORKDAY_MINUTES;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}`;
}

/**
 * `60` → `"1 hora"`, `90` → `"1 hora e 30 minutos"`. Por extenso, para frase
 * corrida — é o que o tooltip do fim do expediente usa.
 */
export function formatDurationLong(minutes: number): string {
  if (minutes <= 0) return 'nenhum intervalo';

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  const hourPart = hours === 1 ? '1 hora' : `${hours} horas`;
  const minutePart = rest === 1 ? '1 minuto' : `${rest} minutos`;

  if (hours === 0) return minutePart;
  if (rest === 0) return hourPart;
  return `${hourPart} e ${minutePart}`;
}

/** `480` → `"08:00"`, para a entrada livre. */
export function durationToTimeString(minutes: number): string {
  const total = Math.max(0, minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/**
 * `"08:30"` → `510`. Devolve `null` para entrada incompleta ou fora de faixa —
 * quem chama decide se mantém o valor anterior.
 *
 * Aceita também a forma sem separador (`"0830"`): a diretiva `appTimeInput` e o
 * handler do campo escutam o mesmo evento `input`, e a ordem entre os dois não é
 * garantida. Tolerar o valor ainda não mascarado sai mais barato que depender
 * dessa ordem.
 */
export function timeStringToDuration(value: string): number | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 4) return null;

  const hours = Number(digits.slice(0, -2));
  const minutes = Number(digits.slice(-2));
  if (minutes > 59) return null;

  const total = hours * 60 + minutes;
  // Jornada de 24h ou mais não descreve nenhum expediente real, e zerar romperia
  // o cálculo do tempo restante.
  return total > 0 && total < 24 * 60 ? total : null;
}
