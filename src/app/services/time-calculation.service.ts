import { Injectable } from '@angular/core';
import { TimeObject } from '../models/time-object';

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

  calculateWorkTime(
    checkIn: string,
    checkOut: string,
    checkIn2: string,
    checkOut2: string = ''
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
    const targetJourneyMinutes = 8 * 60; // 8 horas

    let firstPeriod = 0;
    let secondPeriod = 0;
    let totalWorkedMinutes = 0;
    let remainingMinutes = 0;
    let endTimeMinutes = 0;
    let lunchHourAdded = false;

    // Cenário A: Apenas entrada preenchida
    if (checkInMinutes && !checkOutMinutes && !checkIn2Minutes) {
      lunchHourAdded = true; // Marca que hora de almoço foi adicionada

      if (currentMinutes >= checkInMinutes) {
        firstPeriod = this.calculateTimeDifference(checkInMinutes, currentMinutes);
        totalWorkedMinutes = firstPeriod;
        remainingMinutes = Math.max(0, targetJourneyMinutes - totalWorkedMinutes);

        if (totalWorkedMinutes >= targetJourneyMinutes) {
          // Já completou 8h: fim fixo + 1h de almoço
          endTimeMinutes = checkInMinutes + targetJourneyMinutes + 60;
        } else {
          endTimeMinutes = currentMinutes + remainingMinutes + 60;
        }
      } else {
        firstPeriod = 0;
        totalWorkedMinutes = 0;
        remainingMinutes = targetJourneyMinutes;
        endTimeMinutes = checkInMinutes + targetJourneyMinutes + 60;
      }
    }
    // Cenário B: Entrada e saída preenchidos, sem retorno
    else if (checkInMinutes && checkOutMinutes && !checkIn2Minutes) {
      lunchHourAdded = true; // Marca que hora de almoço foi adicionada

      firstPeriod = this.calculateTimeDifference(checkInMinutes, checkOutMinutes);
      totalWorkedMinutes = firstPeriod;
      remainingMinutes = Math.max(0, targetJourneyMinutes - totalWorkedMinutes);

      if (totalWorkedMinutes >= targetJourneyMinutes) {
        // Já completou 8h no primeiro período: fim fixo + 1h de almoço
        endTimeMinutes = checkInMinutes + targetJourneyMinutes + 60;
      } else {
        // Primeiro período terminou, usa hora atual + tempo restante + 1h de almoço
        endTimeMinutes = currentMinutes + remainingMinutes + 60;
      }
    }
    // Cenário D: Ponto de saída final já batido (2º período fechado, não conta mais o "agora")
    else if (checkInMinutes && checkOutMinutes && checkIn2Minutes && checkOut2Minutes) {
      firstPeriod = this.calculateTimeDifference(checkInMinutes, checkOutMinutes);
      secondPeriod = this.calculateTimeDifference(checkIn2Minutes, checkOut2Minutes);
      totalWorkedMinutes = firstPeriod + secondPeriod;
      remainingMinutes = Math.max(0, targetJourneyMinutes - totalWorkedMinutes);

      if (totalWorkedMinutes >= targetJourneyMinutes) {
        // Completou 8h: horário exato em que atingiu a meta
        const secondPeriodNeeded = targetJourneyMinutes - firstPeriod;
        endTimeMinutes = checkIn2Minutes + secondPeriodNeeded;
      } else {
        // Saiu sem completar a meta: projeção de quando bateria 8h a partir da saída
        endTimeMinutes = checkOut2Minutes + remainingMinutes;
      }
    }
    // Cenário C: Todos os 3 horários preenchidos (entrada, saída e retorno)
    else if (checkInMinutes && checkOutMinutes && checkIn2Minutes) {
      // Primeiro período: entrada até saída (período fechado)
      firstPeriod = this.calculateTimeDifference(checkInMinutes, checkOutMinutes);

      // Segundo período: SÓ conta se hora atual >= checkIn2
      if (currentMinutes >= checkIn2Minutes) {
        secondPeriod = this.calculateTimeDifference(checkIn2Minutes, currentMinutes);
      } else {
        secondPeriod = 0; // Ainda não começou o 2º período
      }

      // Tempo total trabalhado
      totalWorkedMinutes = firstPeriod + secondPeriod;

      // Tempo restante
      remainingMinutes = Math.max(0, targetJourneyMinutes - totalWorkedMinutes);

      // Fim do expediente
      if (totalWorkedMinutes >= targetJourneyMinutes) {
        // Já completou 8h: calcular o horário exato em que atingiu
        const secondPeriodNeeded = targetJourneyMinutes - firstPeriod;
        endTimeMinutes = checkIn2Minutes + secondPeriodNeeded;
      } else if (currentMinutes >= checkIn2Minutes) {
        // Está no 2º período mas ainda não completou: hora atual + tempo restante
        endTimeMinutes = currentMinutes + remainingMinutes;
      } else {
        // Ainda não começou 2º período: checkIn2 + tempo restante
        endTimeMinutes = checkIn2Minutes + remainingMinutes;
      }
    }

    return {
      firstPeriod: this.minutesToTimeObject(firstPeriod),
      secondPeriod: this.minutesToTimeObject(secondPeriod),
      workedTime: this.minutesToTimeObject(totalWorkedMinutes),
      remainingTime: this.minutesToTimeObject(remainingMinutes),
      endTime: this.minutesToTimeObject(endTimeMinutes % (24 * 60)),
      lunchHourAdded: lunchHourAdded
    };
  }
}
