import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TimeUtilsService {
  /**
   * Formata um input de tempo no formato HH:MM
   * @param value Valor atual do input
   * @returns Valor formatado
   */
  formatTimeInput(value: string): string {
    let formattedValue = '', hoursStr = '', minutesStr = '';

    // Extrai horas e minutos se já existe ':' na entrada
    if (value.includes(':')) {
      [hoursStr, minutesStr] = value.split(':').map(v => v.replace(/[^0-9]/g, ''));
    }

    // Processa entrada sem ':' (ex: "1234" vira "12:34")
    if (!value.includes(':')) {
      let onlyNumbersStr = value.replace(/[^0-9]/g, '');

      // Horas entre 0-23 primeiros 2 dígitos são horas
      if (parseInt(onlyNumbersStr.slice(0, 2)) <= 23) {
        hoursStr = onlyNumbersStr.slice(0, 2);
        minutesStr = onlyNumbersStr.slice(2, 4)
      }

      // Horas >= 24 primeiro dígito é hora
      if (parseInt(onlyNumbersStr.slice(0, 2)) >= 24) {
        hoursStr = onlyNumbersStr.slice(0, 1)
        minutesStr = onlyNumbersStr.slice(1, 4)
      }
    }

    // Auto-completa hora se primeiro dígito >= 3 (ex: "3" vira "03")
    if (hoursStr[0] && parseInt(hoursStr[0]) >= 3) {
      hoursStr = '0' + hoursStr[0];
    }

    // Completa hora se há minutos e hora tem 1 dígito
    if (minutesStr && hoursStr.length == 1) {
      hoursStr = '0' + hoursStr[0];
    }

    // Garante horas < 24
    if (parseInt(hoursStr) >= 24) {
      hoursStr = '0' + hoursStr[0];
    }

    // Auto-completa minuto se primeiro dígito >= 6 (ex: "6" vira "06")
    if (minutesStr[0] && parseInt(minutesStr[0]) >= 6) {
      minutesStr = '0' + minutesStr[0];
    }

    // Limita minutos a 2 dígitos
    if (minutesStr && minutesStr.length >= 3) {
      minutesStr = minutesStr.slice(0, 2)
    }

    // Monta o resultado final no formato HH:MM ou HH
    if (minutesStr) {
      formattedValue = hoursStr + ':' + minutesStr;
    } else {
      formattedValue = hoursStr;
    }

    return formattedValue;
  }
}
