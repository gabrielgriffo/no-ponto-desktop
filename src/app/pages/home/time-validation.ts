export type TimeField = 'checkIn' | 'checkOut' | 'checkIn2';

export interface TimeValidation {
  fields: TimeField[];
  message: string | null;
}

interface TimeError {
  field: TimeField;
  message: string;
}

const GENERIC_ERROR = 'Horários informados com erro';

export function timeToMinutes(time: string): number {
  if (!time || time.length !== 5) return -1;
  const [hours, minutes] = time.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return -1;
  return hours * 60 + minutes;
}

function result(errors: TimeError[], message: string | null): TimeValidation {
  return { fields: [...new Set(errors.map(error => error.field))], message };
}

export function validateTimes(checkIn: string, checkOut: string, checkIn2: string): TimeValidation {
  const checkInMinutes = timeToMinutes(checkIn);
  const checkOutMinutes = timeToMinutes(checkOut);
  const checkIn2Minutes = timeToMinutes(checkIn2);

  const formatErrors: TimeError[] = [];
  if (checkIn.length > 0 && checkInMinutes === -1) {
    formatErrors.push({ field: 'checkIn', message: 'Formato de horário de entrada inválido' });
  }
  if (checkOut.length > 0 && checkOutMinutes === -1) {
    formatErrors.push({ field: 'checkOut', message: 'Formato de horário de saída inválido' });
  }
  if (checkIn2.length > 0 && checkIn2Minutes === -1) {
    formatErrors.push({ field: 'checkIn2', message: 'Formato de horário de retorno inválido' });
  }

  if (formatErrors.length > 0) {
    return result(formatErrors, formatErrors.length === 1 ? formatErrors[0].message : GENERIC_ERROR);
  }

  const errors: TimeError[] = [];

  if (checkOutMinutes !== -1 && checkInMinutes === -1) {
    errors.push({ field: 'checkIn', message: 'Horário de entrada não informado' });
  }

  if (checkIn2Minutes !== -1 && checkInMinutes === -1 && checkOutMinutes === -1) {
    errors.push({ field: 'checkIn', message: 'Horários de entrada e saída não informados' });
    errors.push({ field: 'checkOut', message: 'Horários de entrada e saída não informados' });
  } else if (checkIn2Minutes !== -1 && checkInMinutes === -1) {
    errors.push({ field: 'checkIn', message: 'Horário de entrada não informado' });
  } else if (checkIn2Minutes !== -1 && checkOutMinutes === -1) {
    errors.push({ field: 'checkOut', message: 'Horário de saída não informado' });
  }

  if (checkIn.length === 0 && checkOut.length === 0 && checkIn2.length === 0) {
    errors.push({ field: 'checkIn', message: 'Horário de entrada não informado' });
  }

  if (checkOutMinutes !== -1 && checkInMinutes !== -1 && checkOutMinutes < checkInMinutes) {
    errors.push({ field: 'checkOut', message: 'Horário de saída anterior ao de entrada' });
  }

  if (checkIn2Minutes !== -1 && checkOutMinutes !== -1 && checkIn2Minutes < checkOutMinutes) {
    errors.push({ field: 'checkIn2', message: 'Horário de retorno anterior ao de saída' });
  }

  if (errors.length === 0) return result(errors, null);

  const unique = new Set(errors.map(error => error.message));
  return result(errors, unique.size === 1 ? errors[0].message : GENERIC_ERROR);
}
