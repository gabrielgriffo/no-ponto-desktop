import { Injectable } from '@angular/core';
import { TimeObject } from '../models/time-object';

export const DEFAULT_JOURNEY_MINUTES = 480;

export const DEFAULT_BREAK_MINUTES = 60;

@Injectable({
  providedIn: 'root'
})
export class TimeCalculationService {

  timeStringToMinutes(timeString: string): number {
    if (!timeString || !timeString.includes(':')) return 0;
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

  incrementTime(time: TimeObject): void {
    time.minutes += 1;
    if (time.minutes >= 60) {
      time.hours++;
      time.minutes -= 60;
    }
  }

  decrementTime(time: TimeObject): void {
    time.minutes -= 1;
    if (time.minutes < 0) {
      time.hours--;
      time.minutes += 60;
    }
  }

  incrementTimeWithLimit(time: TimeObject, maxHours: number = 24): void {
    this.incrementTime(time);
    if (time.hours >= maxHours) {
      time.hours -= maxHours;
    }
  }

  decrementRemainingTime(time: TimeObject): void {
    time.minutes -= 1;
    if (time.minutes < 0) {
      if (time.hours > 0) {
        time.hours--;
        time.minutes = 59;
      } else {
        time.minutes = 0;
      }
    }
  }

  /**
   * @param targetJourneyMinutes Jornada de referência, em minutos. Vem do
   * `expectedWorkdayMinutes` das configurações — o mesmo valor que o Rust usa
   * para decidir o fim do expediente. Valor não positivo cai no padrão.
   * @param breakMinutes Intervalo presumido, do `defaultBreakMinutes`. Só é
   * somado nos cenários A e B, quando a pausa ainda não foi registrada; a
   * partir do cenário C o intervalo real é a diferença entre saída e retorno.
   * Zero é válido e significa jornada sem pausa.
   */
  calculateWorkTime(
    checkIn: string,
    checkOut: string,
    checkIn2: string,
    checkOut2: string = '',
    targetJourneyMinutes: number = DEFAULT_JOURNEY_MINUTES,
    breakMinutes: number = DEFAULT_BREAK_MINUTES
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
    if (checkInMinutes && !checkOutMinutes && !checkIn2Minutes) {
      lunchHourAdded = true;

      if (currentMinutes >= checkInMinutes) {
        firstPeriod = this.calculateTimeDifference(checkInMinutes, currentMinutes);
        totalWorkedMinutes = firstPeriod;
        remainingMinutes = Math.max(0, targetJourneyMinutes - totalWorkedMinutes);

        if (totalWorkedMinutes >= targetJourneyMinutes) {
          endTimeMinutes = checkInMinutes + targetJourneyMinutes + breakMinutes;
        } else {
          endTimeMinutes = currentMinutes + remainingMinutes + breakMinutes;
        }
      } else {
        firstPeriod = 0;
        totalWorkedMinutes = 0;
        remainingMinutes = targetJourneyMinutes;
        endTimeMinutes = checkInMinutes + targetJourneyMinutes + breakMinutes;
      }
    }
    // Cenário B: Entrada e saída preenchidos, sem retorno
    else if (checkInMinutes && checkOutMinutes && !checkIn2Minutes) {
      lunchHourAdded = true;

      firstPeriod = this.calculateTimeDifference(checkInMinutes, checkOutMinutes);
      totalWorkedMinutes = firstPeriod;
      remainingMinutes = Math.max(0, targetJourneyMinutes - totalWorkedMinutes);

      if (totalWorkedMinutes >= targetJourneyMinutes) {
        endTimeMinutes = checkInMinutes + targetJourneyMinutes + breakMinutes;
      } else {
        endTimeMinutes = currentMinutes + remainingMinutes + breakMinutes;
      }
    }
    // Cenário D: Ponto de saída final já batido (2º período fechado, não conta mais o "agora")
    else if (checkInMinutes && checkOutMinutes && checkIn2Minutes && checkOut2Minutes) {
      firstPeriod = this.calculateTimeDifference(checkInMinutes, checkOutMinutes);
      secondPeriod = this.calculateTimeDifference(checkIn2Minutes, checkOut2Minutes);
      totalWorkedMinutes = firstPeriod + secondPeriod;
      remainingMinutes = Math.max(0, targetJourneyMinutes - totalWorkedMinutes);

      if (totalWorkedMinutes >= targetJourneyMinutes) {
        const secondPeriodNeeded = targetJourneyMinutes - firstPeriod;
        endTimeMinutes = checkIn2Minutes + secondPeriodNeeded;
      } else {
        endTimeMinutes = checkOut2Minutes + remainingMinutes;
      }
    }
    // Cenário C: Todos os 3 horários preenchidos (entrada, saída e retorno)
    else if (checkInMinutes && checkOutMinutes && checkIn2Minutes) {
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
        const secondPeriodNeeded = targetJourneyMinutes - firstPeriod;
        endTimeMinutes = checkIn2Minutes + secondPeriodNeeded;
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
}
