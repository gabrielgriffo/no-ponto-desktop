import { Injectable } from '@angular/core';
import { TimeObject } from '../models/time-object';

export const DEFAULT_JOURNEY_MINUTES = 480;

export const DEFAULT_BREAK_MINUTES = 60;

@Injectable({
  providedIn: 'root'
})
export class TimeCalculationService {

  /** -1 indica horário ausente; 0 é meia-noite, um horário válido. */
  timeStringToMinutes(timeString: string): number {
    if (!timeString || !timeString.includes(':')) return -1;
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
  }

  // Trata virada de dia: se end < start, adiciona 24h
  calculateTimeDifference(startMinutes: number, endMinutes: number): number {
    if (endMinutes >= startMinutes) {
      return endMinutes - startMinutes;
    } else {
      return (endMinutes + 1440) - startMinutes;
    }
  }

  minutesToTimeObject(totalMinutes: number): TimeObject {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return { hours, minutes };
  }

  getCurrentTimeInMinutes(): number {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  /**
   * @param targetJourneyMinutes Jornada de referência, em minutos. Vem do
   * `expectedWorkdayMinutes` das configurações — o mesmo valor que o Rust usa
   * para decidir o fim do expediente. Valor não positivo cai no padrão.
   * @param breakMinutes Intervalo presumido, do `defaultBreakMinutes`. Só é
   * somado nos cenários A e B, quando a pausa ainda não foi registrada; a
   * partir do cenário C o intervalo real é a diferença entre saída e retorno.
   * Zero é válido e significa jornada sem pausa.
   * @param extraTimes Batidas além da quarta, em ordem (segundo intervalo e retorno).
   */
  calculateWorkTime(
    checkIn: string,
    checkOut: string,
    checkIn2: string,
    checkOut2: string = '',
    targetJourneyMinutes: number = DEFAULT_JOURNEY_MINUTES,
    breakMinutes: number = DEFAULT_BREAK_MINUTES,
    extraTimes: string[] = []
  ): {
    firstPeriod: TimeObject;
    secondPeriod: TimeObject;
    workedTime: TimeObject;
    remainingTime: TimeObject;
    endTime: TimeObject;
    lunchHourAdded: boolean;
  } {
    const checkInMinutes = this.timeStringToMinutes(checkIn);
    const checkOutMinutes = this.timeStringToMinutes(checkOut);
    const checkIn2Minutes = this.timeStringToMinutes(checkIn2);
    const checkOut2Minutes = this.timeStringToMinutes(checkOut2);
    const currentMinutes = this.getCurrentTimeInMinutes();
    const hasCheckIn = checkInMinutes >= 0;
    const hasCheckOut = checkOutMinutes >= 0;
    const hasCheckIn2 = checkIn2Minutes >= 0;
    const hasCheckOut2 = checkOut2Minutes >= 0;

    // Jornada zerada ou negativa deixaria o tempo restante sem sentido; o padrão
    // é a mesma salvaguarda que o Rust aplica em `expected_workday_minutes()`.
    if (targetJourneyMinutes <= 0) {
      targetJourneyMinutes = DEFAULT_JOURNEY_MINUTES;
    }

    // Intervalo negativo adiantaria o fim do expediente; zero é legítimo.
    if (breakMinutes < 0) {
      breakMinutes = 0;
    }

    let firstPeriod = 0;
    let secondPeriod = 0;
    let totalWorkedMinutes = 0;
    let remainingMinutes = 0;
    let endTimeMinutes = 0;
    let lunchHourAdded = false;

    // Cenário A: Apenas entrada preenchida
    if (hasCheckIn && !hasCheckOut && !hasCheckIn2) {
      lunchHourAdded = true;

      // O tempo restante é só o trabalho que falta; o intervalo ainda não
      // registrado entra apenas no horário de fim.
      endTimeMinutes = checkInMinutes + targetJourneyMinutes + breakMinutes;

      if (currentMinutes >= checkInMinutes) {
        firstPeriod = this.calculateTimeDifference(checkInMinutes, currentMinutes);
        totalWorkedMinutes = firstPeriod;
        remainingMinutes = Math.max(0, targetJourneyMinutes - totalWorkedMinutes);
      } else {
        remainingMinutes = targetJourneyMinutes;
      }
    }
    // Cenário B: Entrada e saída preenchidos, sem retorno
    else if (hasCheckIn && hasCheckOut && !hasCheckIn2) {
      lunchHourAdded = true;

      firstPeriod = this.calculateTimeDifference(checkInMinutes, checkOutMinutes);
      totalWorkedMinutes = firstPeriod;
      remainingMinutes = Math.max(0, targetJourneyMinutes - totalWorkedMinutes);

      if (totalWorkedMinutes >= targetJourneyMinutes) {
        // A jornada fechou antes de qualquer intervalo: não há pausa a somar.
        lunchHourAdded = false;
        endTimeMinutes = checkInMinutes + targetJourneyMinutes;
      } else {
        const breakEndMinutes = checkOutMinutes + breakMinutes;
        lunchHourAdded = breakEndMinutes > currentMinutes;
        endTimeMinutes = Math.max(breakEndMinutes, currentMinutes) + remainingMinutes;
      }
    }
    // Cenário E: mais de quatro batidas (novo intervalo). Soma os pares como o Rust faz;
    // quantidade ímpar significa um período aberto até agora.
    else if (hasCheckIn && hasCheckOut && hasCheckIn2 && hasCheckOut2 && extraTimes.length > 0) {
      const times = [checkInMinutes, checkOutMinutes, checkIn2Minutes, checkOut2Minutes,
        ...extraTimes.map(time => this.timeStringToMinutes(time)).filter(minutes => minutes >= 0)];
      const periods: { start: number; length: number; open: boolean }[] = [];

      for (let i = 0; i < times.length; i += 2) {
        const start = times[i];
        const end = times[i + 1];
        if (end !== undefined) {
          periods.push({ start, length: this.calculateTimeDifference(start, end), open: false });
        } else if (currentMinutes >= start) {
          periods.push({ start, length: this.calculateTimeDifference(start, currentMinutes), open: true });
        } else {
          periods.push({ start, length: 0, open: true });
        }
      }

      firstPeriod = periods[0].length;
      totalWorkedMinutes = periods.reduce((sum, period) => sum + period.length, 0);
      secondPeriod = totalWorkedMinutes - firstPeriod;
      remainingMinutes = Math.max(0, targetJourneyMinutes - totalWorkedMinutes);

      const last = periods[periods.length - 1];
      let accumulated = 0;
      endTimeMinutes = last.open
        ? Math.max(last.start, currentMinutes) + remainingMinutes
        : times[times.length - 1] + remainingMinutes;

      for (const period of periods) {
        if (accumulated + period.length >= targetJourneyMinutes) {
          endTimeMinutes = period.start + (targetJourneyMinutes - accumulated);
          break;
        }
        accumulated += period.length;
      }
    }
    // Cenário D: Ponto de saída final já batido (2º período fechado, não conta mais o "agora")
    else if (hasCheckIn && hasCheckOut && hasCheckIn2 && hasCheckOut2) {
      firstPeriod = this.calculateTimeDifference(checkInMinutes, checkOutMinutes);
      secondPeriod = this.calculateTimeDifference(checkIn2Minutes, checkOut2Minutes);
      totalWorkedMinutes = firstPeriod + secondPeriod;
      remainingMinutes = Math.max(0, targetJourneyMinutes - totalWorkedMinutes);

      if (totalWorkedMinutes >= targetJourneyMinutes) {
        endTimeMinutes = this.completedJourneyEnd(checkInMinutes, checkIn2Minutes, firstPeriod, targetJourneyMinutes);
      } else {
        endTimeMinutes = checkOut2Minutes + remainingMinutes;
      }
    }
    // Cenário C: Todos os 3 horários preenchidos (entrada, saída e retorno)
    else if (hasCheckIn && hasCheckOut && hasCheckIn2) {
      firstPeriod = this.calculateTimeDifference(checkInMinutes, checkOutMinutes);

      // Segundo período: SÓ conta se hora atual >= checkIn2
      if (currentMinutes >= checkIn2Minutes) {
        secondPeriod = this.calculateTimeDifference(checkIn2Minutes, currentMinutes);
      } else {
        secondPeriod = 0; // Ainda não começou o 2º período
      }

      totalWorkedMinutes = firstPeriod + secondPeriod;

      remainingMinutes = Math.max(0, targetJourneyMinutes - totalWorkedMinutes);

      if (totalWorkedMinutes >= targetJourneyMinutes) {
        endTimeMinutes = this.completedJourneyEnd(checkInMinutes, checkIn2Minutes, firstPeriod, targetJourneyMinutes);
      } else if (currentMinutes >= checkIn2Minutes) {
        endTimeMinutes = currentMinutes + remainingMinutes;
      } else {
        endTimeMinutes = checkIn2Minutes + remainingMinutes;
      }
    }

    return {
      firstPeriod: this.minutesToTimeObject(firstPeriod),
      secondPeriod: this.minutesToTimeObject(secondPeriod),
      workedTime: this.minutesToTimeObject(totalWorkedMinutes),
      remainingTime: this.minutesToTimeObject(remainingMinutes),
      endTime: this.minutesToTimeObject(endTimeMinutes % (24 * 60)),
      // Com intervalo zerado nada foi somado: o ícone de ajuda não tem o que explicar
      lunchHourAdded: lunchHourAdded && breakMinutes > 0
    };
  }

  // Se o primeiro período sozinho já cobre a jornada, ela fechou antes do intervalo.
  private completedJourneyEnd(checkIn: number, checkIn2: number, firstPeriod: number, target: number): number {
    return firstPeriod >= target ? checkIn + target : checkIn2 + (target - firstPeriod);
  }
}
