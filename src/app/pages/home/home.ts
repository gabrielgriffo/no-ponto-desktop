import { Component, ViewChild, ElementRef, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SettingsModal } from '../settings-modal/settings-modal';
import { FlipText } from '../../components/flip-text/flip-text';
import { TooltipDirective } from '../../directives/tooltip.directive';
import { TimeFormatPipe } from '../../pipes/time-format.pipe';
import { TimeInputDirective } from '../../directives/time-input.directive';
import { invoke } from '@tauri-apps/api/core';
import { TimeCalculationService } from '../../services/time-calculation.service';
import { WindowService } from '../../services/window.service';
import { TimeObject } from '../../models/time-object';
import { TimeUtilsService } from '../../services/time-utils.service';
import { ToastService } from '../../services/toast.service';
import { PontoMaisService } from '../../services/pontomais.service';
import { StrongholdService } from '../../services/stronghold.service';
import { Subscription, timer } from 'rxjs';

@Component({
  selector: 'app-home',
  imports: [CommonModule, SettingsModal, FlipText, TooltipDirective, TimeFormatPipe, TimeInputDirective],
  templateUrl: './home.html',
  styleUrl: './home.css'
})
export class Home implements OnInit, OnDestroy {
  showSettingsModal = false;
  isMonitoring = false;
  isPontomaisLoggedIn = false;
  isImporting = false;

  @ViewChild('checkInInput') checkInInput!: ElementRef<HTMLInputElement>;
  @ViewChild('checkOutInput') checkOutInput!: ElementRef<HTMLInputElement>;
  @ViewChild('checkIn2Input') checkIn2Input!: ElementRef<HTMLInputElement>;

  checkInError = false;
  checkOutError = false;
  checkIn2Error = false;

  workedTime: TimeObject = { hours: 0, minutes: 0 };
  remainingTime: TimeObject = { hours: 0, minutes: 0 };
  firstPeriodTime: TimeObject = { hours: 0, minutes: 0 };
  secondPeriodTime: TimeObject = { hours: 0, minutes: 0 };
  endTime: TimeObject = { hours: 0, minutes: 0 };
  hasLunchHourAdded: boolean = false;

  private updateInterval: any;
  private capturedCheckIn: string = '';
  private capturedCheckOut: string = '';
  private capturedCheckIn2: string = '';
  private errorTimerSub?: Subscription;
  private windowFocusHandler?: () => void;
  private mouseMoveHandler?: () => void;
  private sessionRestorePromise?: Promise<void>;

  constructor(
    private timeCalc: TimeCalculationService,
    private timeUtils: TimeUtilsService,
    private windowService: WindowService,
    private toastService: ToastService,
    private pontoMaisService: PontoMaisService,
    private strongholdService: StrongholdService
  ) { }

  async ngOnInit() {
    // Habilitar botão rapidamente com o estado salvo em cache (JSON simples, < 50ms)
    try {
      const cached = await invoke<{ isPontomaisLoggedIn: boolean }>('load_settings');
      this.isPontomaisLoggedIn = cached.isPontomaisLoggedIn;
    } catch {}

    // Restaurar sessão do Stronghold em segundo plano (operação lenta)
    // onImportClick aguarda essa promise antes de executar
    this.sessionRestorePromise = this.restoreSessionFromStorage();

    // Remover foco quando a janela se tornar visível ou mouse se mover
    const removeFocus = () => {
      const activeElement = document.activeElement as HTMLElement;
      if (activeElement && activeElement.blur && activeElement.tagName !== 'INPUT') {
        activeElement.blur();
      }
    };

    // Evento de visibilidade da página
    this.windowFocusHandler = () => {
      if (!document.hidden) {
        setTimeout(removeFocus, 100);
      }
    };
    document.addEventListener('visibilitychange', this.windowFocusHandler);

    // Remove foco quando mouse se move
    let canRemoveFocus = true;
    this.mouseMoveHandler = () => {
      if (canRemoveFocus) {
        removeFocus();
        canRemoveFocus = false;
        // Permite remover foco novamente após 500ms
        setTimeout(() => {
          canRemoveFocus = true;
        }, 500);
      }
    };
    document.addEventListener('mousemove', this.mouseMoveHandler);
  }

  private async restoreSessionFromStorage(): Promise<void> {
    const token = await this.strongholdService.getToken();
    if (token) {
      try {
        await this.pontoMaisService.restoreSession(
          token.token,
          token.client_id,
          token.expiry,
          token.uid
        );
        this.isPontomaisLoggedIn = true;
      } catch (error) {
        console.error('Erro ao restaurar sessão:', error);
        this.isPontomaisLoggedIn = false;
      }
    } else {
      this.isPontomaisLoggedIn = false;
    }
  }

  updateWorkTime(): void {
    const result = this.timeCalc.calculateWorkTime(
      this.capturedCheckIn,
      this.capturedCheckOut,
      this.capturedCheckIn2
    );

    this.firstPeriodTime = result.firstPeriod;
    this.secondPeriodTime = result.secondPeriod;
    this.workedTime = result.workedTime;
    this.remainingTime = result.remainingTime;
    this.endTime = result.endTime;
    this.hasLunchHourAdded = result.lunchHourAdded;
  }

  get progressPercentageValue(): number {
    const totalWorkMinutes = (this.workedTime.hours * 60) + this.workedTime.minutes;
    const totalJourneyMinutes = 8 * 60;
    const percentage = (totalWorkMinutes / totalJourneyMinutes) * 100;
    return Math.min(percentage, 100);
  }

  get firstPeriodPercentage(): number {
    const firstPeriodMinutes = (this.firstPeriodTime.hours * 60) + this.firstPeriodTime.minutes;
    const totalJourneyMinutes = 8 * 60;
    const percentage = (firstPeriodMinutes / totalJourneyMinutes) * 100;
    return Math.min(percentage, 100);
  }

  get secondPeriodPercentage(): number {
    const secondPeriodMinutes = (this.secondPeriodTime.hours * 60) + this.secondPeriodTime.minutes;
    const totalJourneyMinutes = 8 * 60;
    const percentage = (secondPeriodMinutes / totalJourneyMinutes) * 100;
    return Math.min(percentage, 100);
  }

  get hasFirstPeriod(): boolean {
    return this.capturedCheckIn.length > 0;
  }

  get hasSecondPeriod(): boolean {
    return this.capturedCheckIn2.length > 0;
  }

  /**
   * Converte um horário no formato HH:MM para minutos totais
   */
  private timeToMinutes(time: string): number {
    if (!time || time.length !== 5) return -1;
    const [hours, minutes] = time.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return -1;
    return hours * 60 + minutes;
  }

  showError() {
    this.checkInError = true;

    // Cancela timer anterior
    this.errorTimerSub?.unsubscribe();

    this.errorTimerSub = timer(3000).subscribe(() => {
      this.clearTimeErrors();
    });
  }

  clearTimeErrors(): void {
    this.checkInError = false;
    this.checkOutError = false;
    this.checkIn2Error = false;

    if (this.errorTimerSub) {
      this.errorTimerSub.unsubscribe();
      this.errorTimerSub = undefined;
    }
  }

  onInputFocus() {
    this.clearTimeErrors();
  }

  /**
   * Valida os horários verificando seguindo regras específicas
   */
  validateTimeInputs(): void {
    const checkIn = this.checkInInput?.nativeElement.value || '';
    const checkOut = this.checkOutInput?.nativeElement.value || '';
    const checkIn2 = this.checkIn2Input?.nativeElement.value || '';

    const checkInMinutes = this.timeToMinutes(checkIn);
    const checkOutMinutes = this.timeToMinutes(checkOut);
    const checkIn2Minutes = this.timeToMinutes(checkIn2);

    this.clearTimeErrors();

    const errors: Array<{ field: 'checkIn' | 'checkOut' | 'checkIn2'; message: string }> = [];

    // FASE 1: Validar formato dos campos preenchidos
    if (checkIn.length > 0 && checkInMinutes === -1) {
      errors.push({ field: 'checkIn', message: 'Formato de horário de entrada inválido' });
    }

    if (checkOut.length > 0 && checkOutMinutes === -1) {
      errors.push({ field: 'checkOut', message: 'Formato de horário de saída inválido' });
    }

    if (checkIn2.length > 0 && checkIn2Minutes === -1) {
      errors.push({ field: 'checkIn2', message: 'Formato de horário de retorno inválido' });
    }

    // Se houver erros de formato, para aqui e não valida regras de negócio
    if (errors.length > 0) {
      errors.forEach(error => {
        if (error.field === 'checkIn') this.checkInError = true;
        if (error.field === 'checkOut') this.checkOutError = true;
        if (error.field === 'checkIn2') this.checkIn2Error = true;
      });

      if (errors.length === 1) {
        this.toastService.error(errors[0].message, 3000);
      } else if (errors.length > 1) {
        this.toastService.error('Horários informados com erro', 3000);
      }

      this.errorTimerSub = timer(3000).subscribe(() => {
        this.clearTimeErrors();
      });

      return;
    }

    // FASE 2: Validar regras de negócio (só executa se todos os campos preenchidos são válidos)

    // Validações de dependência (quando campos posteriores estão preenchidos)
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

    // Validação de campo obrigatório (só verifica se nenhum campo posterior está preenchido)
    if (checkIn.length === 0 && checkOut.length === 0 && checkIn2.length === 0) {
      errors.push({ field: 'checkIn', message: 'Horário de entrada não informado' });
    }

    if (checkOutMinutes !== -1 && checkInMinutes !== -1 && checkOutMinutes < checkInMinutes) {
      errors.push({ field: 'checkOut', message: 'Horário de saída anterior ao de entrada' });
    }

    if (checkIn2Minutes !== -1 && checkOutMinutes !== -1 && checkIn2Minutes < checkOutMinutes) {
      errors.push({ field: 'checkIn2', message: 'Horário de retorno anterior ao de saída' });
    }

    errors.forEach(error => {
      if (error.field === 'checkIn') this.checkInError = true;
      if (error.field === 'checkOut') this.checkOutError = true;
      if (error.field === 'checkIn2') this.checkIn2Error = true;
    });

    if (errors.length === 1) {
      this.toastService.error(errors[0].message, 3000);
    } else if (errors.length > 1) {
      const uniqueMessages = new Set(errors.map(e => e.message));
      if (uniqueMessages.size === 1) {
        // Todos os erros têm a mesma mensagem, mostra ela
        this.toastService.error(errors[0].message, 3000);
      } else {
        this.toastService.error('Horários informados com erro', 3000);
      }
    }

    if (errors.length > 0) {
      this.errorTimerSub = timer(3000).subscribe(() => {
        this.clearTimeErrors();
      });
    }
  }

  async onMinimizeClick(): Promise<void> {
    await this.windowService.minimize();
  }

  async onCloseClick(): Promise<void> {
    await this.windowService.close();
  }

  onStartMonitoringClick(): void {

    this.validateTimeInputs();

    if (!this.checkInError && !this.checkOutError && !this.checkIn2Error) {
      this.capturedCheckIn = this.checkInInput.nativeElement.value;
      this.capturedCheckOut = this.checkOutInput.nativeElement.value;
      this.capturedCheckIn2 = this.checkIn2Input.nativeElement.value;

      this.updateWorkTime();

      this.isMonitoring = true;

      if (this.updateInterval) {
        clearInterval(this.updateInterval);
      }
      this.updateInterval = setInterval(() => {
        this.updateWorkTime();
      }, 1000);
    } else {
      this.isMonitoring = false;
    }
  }

  async onImportClick(): Promise<void> {
    if (this.isImporting) return;

    try {
      this.isImporting = true;

      // Aguarda restauração de sessão caso ainda esteja em andamento
      await this.sessionRestorePromise;

      if (!this.isPontomaisLoggedIn) {
        this.toastService.error('Configure uma integração nas configurações para importar', 3000);
        return;
      }

      // 2. Buscar horários do dia atual
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const workDay = await this.pontoMaisService.getCurrentWorkDay(today);

      // 3. Se não há registros
      if (!workDay?.work_days?.[0]?.time_cards?.length) {
        this.toastService.error('Nenhum registro encontrado para hoje', 3000);
        return;
      }

      // 4. Extrair horários e formatar usando timeUtils.formatTimeInput()
      const cards = workDay.work_days[0].time_cards;
      let importedCount = 0;

      if (cards[0]) {
        this.checkInInput.nativeElement.value =
          this.timeUtils.formatTimeInput(cards[0].time);
        importedCount++;
      }

      if (cards[1]) {
        this.checkOutInput.nativeElement.value =
          this.timeUtils.formatTimeInput(cards[1].time);
        importedCount++;
      }

      if (cards[2]) {
        this.checkIn2Input.nativeElement.value =
          this.timeUtils.formatTimeInput(cards[2].time);
        importedCount++;
      }

      this.toastService.success('Horários importados com sucesso!');

      // 5. Se importou pelo menos 1 horário, iniciar monitoramento automaticamente
      if (importedCount > 0) {
        this.onStartMonitoringClick();
      }

    } catch (error) {
      console.error('Erro ao importar:', error);
      this.toastService.error('Erro ao importar horários', 3000);
    } finally {
      this.isImporting = false;
    }
  }

  onSettingsClick(): void {
    this.showSettingsModal = true;
  }

  async onCloseSettingsModal(): Promise<void> {
    this.showSettingsModal = false;
    // Recarregar status de login ao fechar o modal
    this.isPontomaisLoggedIn = await this.strongholdService.hasToken();
  }

  ngOnDestroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    if (this.windowFocusHandler) {
      document.removeEventListener('visibilitychange', this.windowFocusHandler);
    }

    if (this.mouseMoveHandler) {
      document.removeEventListener('mousemove', this.mouseMoveHandler);
    }
  }
}
