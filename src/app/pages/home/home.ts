import { Component, ViewChild, ElementRef, NgZone, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SettingsModal } from '../settings-modal/settings-modal';
import { FlipText } from '../../components/flip-text/flip-text';
import { TooltipDirective } from '../../directives/tooltip.directive';
import { TimeFormatPipe } from '../../pipes/time-format.pipe';
import { TimeInputDirective } from '../../directives/time-input.directive';
import { TimeCalculationService, DEFAULT_JOURNEY_MINUTES, DEFAULT_BREAK_MINUTES } from '../../services/time-calculation.service';
import { AppSettings, formatDurationLong, formatIntervalShort } from '../settings-modal/settings.model';
import { UpdateService } from '../../services/update.service';
import { WindowService } from '../../services/window.service';
import { TimeObject } from '../../models/time-object';
import { TimeUtilsService } from '../../services/time-utils.service';
import { ToastService } from '../../services/toast.service';
import { PontoMaisService, WorkDaysResponse } from '../../services/pontomais.service';
import { CredentialsService } from '../../services/credentials.service';
import { Subscription, timer } from 'rxjs';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

interface AutoSyncPayload {
  status: 'success' | 'error' | 'unauthenticated';
  data?: WorkDaysResponse;
  message?: string;
}

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
  autoImportEnabled = false;
  autoImportInterval = 10;
  importOnStartupEnabled = false;
  expectedWorkdayMinutes = DEFAULT_JOURNEY_MINUTES;
  defaultBreakMinutes = DEFAULT_BREAK_MINUTES;

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
  private capturedCheckOut2: string = '';
  private errorTimerSub?: Subscription;
  private windowFocusHandler?: () => void;
  private mouseMoveHandler?: () => void;
  private sessionRestorePromise?: Promise<void>;
  private autoSyncUnlisten?: UnlistenFn;

  constructor(
    private timeCalc: TimeCalculationService,
    private timeUtils: TimeUtilsService,
    private windowService: WindowService,
    private toastService: ToastService,
    private pontoMaisService: PontoMaisService,
    private credentialsService: CredentialsService,
    private updateService: UpdateService,
    private zone: NgZone
  ) { }

  async ngOnInit() {
    // Habilitar botão rapidamente com o estado salvo em cache (JSON simples, < 50ms)
    try {
      const cached = await invoke<{
        isPontomaisLoggedIn: boolean;
        autoImportEnabled: boolean;
        autoImportInterval: number;
        importOnStartupEnabled: boolean;
        expectedWorkdayMinutes: number;
        defaultBreakMinutes: number;
      }>('load_settings');
      this.isPontomaisLoggedIn = cached.isPontomaisLoggedIn;
      this.autoImportEnabled = cached.autoImportEnabled;
      this.autoImportInterval = cached.autoImportInterval;
      this.importOnStartupEnabled = cached.importOnStartupEnabled;
      this.expectedWorkdayMinutes = cached.expectedWorkdayMinutes;
      this.defaultBreakMinutes = cached.defaultBreakMinutes;
    } catch {}

    // Registrar listener ANTES de restaurar sessão para não perder eventos iniciais.
    // O Tauri entrega eventos avaliando script pelo lado nativo (runCallback), caminho
    // que o zone.js não intercepta — sem o zone.run o handler rodaria na zona raiz e
    // nem a detecção de mudanças nem o setInterval de onStartMonitoringClick seriam
    // agendados no Angular, deixando as métricas congeladas.
    this.autoSyncUnlisten = await listen<AutoSyncPayload>(
      'auto-sync-result',
      (event) => this.zone.run(() => this.onAutoSyncResult(event.payload))
    );

    // Restaurar sessão a partir do keyring do SO em segundo plano
    // onImportClick aguarda essa promise antes de executar
    this.sessionRestorePromise = this.restoreSessionFromStorage();

    this.checkForUpdateSilently();

    // Remover foco quando a janela se tornar visível ou mouse se mover
    const removeFocus = () => {
      const activeElement = document.activeElement as HTMLElement;
      if (activeElement && activeElement.blur && activeElement.tagName !== 'INPUT') {
        activeElement.blur();
      }
    };

    this.windowFocusHandler = () => {
      if (!document.hidden) {
        setTimeout(removeFocus, 100);
      }
    };
    document.addEventListener('visibilitychange', this.windowFocusHandler);

    let canRemoveFocus = true;
    this.mouseMoveHandler = () => {
      if (canRemoveFocus) {
        removeFocus();
        canRemoveFocus = false;
        setTimeout(() => {
          canRemoveFocus = true;
        }, 500);
      }
    };
    document.addEventListener('mousemove', this.mouseMoveHandler);
  }

  private async restoreSessionFromStorage(): Promise<void> {
    const token = await this.credentialsService.getToken();
    if (token) {
      try {
        await this.pontoMaisService.restoreSession(
          token.token,
          token.client_id,
          token.expiry,
          token.uid
        );
        this.isPontomaisLoggedIn = true;

        // Iniciar sincronização automática agora que a sessão está no estado Rust
        if (this.autoImportEnabled) {
          await invoke('configure_auto_sync', {
            enabled: true,
            intervalMins: this.autoImportInterval
          });
        }

        // Importar horários automaticamente ao iniciar, se habilitado.
        // Chama onImportClick diretamente para reaproveitar o feedback visual
        // (spinner/toast) e o guard de isImporting, evitando clique duplicado
        // enquanto a importação automática está em andamento. Pula a espera pela
        // sessão pois já estamos dentro dela (evita deadlock com sessionRestorePromise).
        if (this.importOnStartupEnabled) {
          const workDay = await this.onImportClick(true);

          if (workDay) {
            await invoke('external_app_maybe_launch', {
              workDay,
              date: this.todayLocalDate()
            });
          }
        }
      } catch (error) {
        console.error('Erro ao restaurar sessão:', error);
        // Token existe no keyring mas a restauração falhou (sessão expirada, erro de rede).
        // Manter isPontomaisLoggedIn como estava no cache — o usuário ainda está "logado",
        // mas a sessão ativa pode estar inválida. Evita divergência com as configurações.
      }
    } else {
      this.isPontomaisLoggedIn = false;
    }
  }

  private onAutoSyncResult(payload: AutoSyncPayload): void {
    if (payload.status === 'success' && payload.data) {
      this.applyImportedCards(payload.data);
    } else if (payload.status === 'error') {
      if (payload.message === 'SESSION_EXPIRED') {
        this.handleSessionExpired();
      } else {
        console.warn('[auto-sync] Erro:', payload.message);
      }
    }
    // 'unauthenticated': sessão ainda não restaurada, ignorar silenciosamente
  }

  private async handleSessionExpired(): Promise<void> {
    // Mesmo com o token já inválido, zera a sessão do Rust — senão ela sobreviveria
    // em memória até o app reiniciar, igual acontecia no logout.
    try {
      await this.pontoMaisService.clearSession();
    } catch (error) {
      console.error('Erro ao encerrar sessão no PontoMais:', error);
    }

    await this.credentialsService.deleteToken();
    this.isPontomaisLoggedIn = false;

    try {
      const fullSettings = await invoke<Record<string, unknown>>('load_settings');
      await invoke('save_settings', { settings: { ...fullSettings, isPontomaisLoggedIn: false } });
    } catch (error) {
      console.error('Erro ao atualizar configurações após expiração de sessão:', error);
    }

    await invoke('configure_auto_sync', { enabled: false, intervalMins: this.autoImportInterval });

    this.toastService.error('Sessão expirada. Faça login novamente nas configurações.', 5000);
  }

  private applyImportedCards(workDay: WorkDaysResponse): number {
    const cards = workDay?.work_days?.[0]?.time_cards;
    if (!cards?.length) return 0;

    let count = 0;
    if (cards[0]) {
      this.checkInInput.nativeElement.value = this.timeUtils.formatTimeInput(cards[0].time);
      count++;
    }
    if (cards[1]) {
      this.checkOutInput.nativeElement.value = this.timeUtils.formatTimeInput(cards[1].time);
      count++;
    }
    if (cards[2]) {
      this.checkIn2Input.nativeElement.value = this.timeUtils.formatTimeInput(cards[2].time);
      count++;
    }
    if (count > 0) {
      this.onStartMonitoringClick();
      this.capturedCheckOut2 = cards[3] ? this.timeUtils.formatTimeInput(cards[3].time) : '';
      this.updateWorkTime();
    }
    return count;
  }

  updateWorkTime(): void {
    const result = this.timeCalc.calculateWorkTime(
      this.capturedCheckIn,
      this.capturedCheckOut,
      this.capturedCheckIn2,
      this.capturedCheckOut2,
      this.expectedWorkdayMinutes,
      this.defaultBreakMinutes
    );

    this.firstPeriodTime = result.firstPeriod;
    this.secondPeriodTime = result.secondPeriod;
    this.workedTime = result.workedTime;
    this.remainingTime = result.remainingTime;
    this.endTime = result.endTime;
    this.hasLunchHourAdded = result.lunchHourAdded;
  }

  get lunchHourTooltip(): string {
    return `O cálculo foi ajustado para incluir ${formatDurationLong(this.defaultBreakMinutes)} de intervalo`;
  }

  private get journeyMinutes(): number {
    return this.expectedWorkdayMinutes > 0
      ? this.expectedWorkdayMinutes
      : DEFAULT_JOURNEY_MINUTES;
  }

  get progressPercentageValue(): number {
    const totalWorkMinutes = (this.workedTime.hours * 60) + this.workedTime.minutes;
    const percentage = (totalWorkMinutes / this.journeyMinutes) * 100;
    return Math.min(percentage, 100);
  }

  get firstPeriodPercentage(): number {
    const firstPeriodMinutes = (this.firstPeriodTime.hours * 60) + this.firstPeriodTime.minutes;
    const percentage = (firstPeriodMinutes / this.journeyMinutes) * 100;
    return Math.min(percentage, 100);
  }

  get secondPeriodPercentage(): number {
    const secondPeriodMinutes = (this.secondPeriodTime.hours * 60) + this.secondPeriodTime.minutes;
    const percentage = (secondPeriodMinutes / this.journeyMinutes) * 100;
    return Math.min(percentage, 100);
  }

  get hasFirstPeriod(): boolean {
    return this.capturedCheckIn.length > 0;
  }

  get hasSecondPeriod(): boolean {
    return this.capturedCheckIn2.length > 0;
  }

  get isWorkDayComplete(): boolean {
    return this.capturedCheckOut2.length > 0;
  }

  get isOnBreak(): boolean {
    return this.hasFirstPeriod && this.capturedCheckOut.length > 0 && !this.hasSecondPeriod;
  }

  get autoSyncTooltip(): string {
    if (!this.isPontomaisLoggedIn) {
      return 'Conecte-se a uma conta';
    }
    if (!this.autoImportEnabled) {
      return 'Sincronização automática';
    }
    return `Sincronização automática a cada ${formatDurationLong(this.autoImportInterval)}`;
  }

  get autoSyncIntervalLabel(): string {
    return formatIntervalShort(this.autoImportInterval);
  }

  /**
   * Data de hoje no fuso local, no formato aceito pela API (YYYY-MM-DD).
   * Não usar `toISOString()`: ele converte para UTC e, em UTC-3, a partir das 21h
   * já retorna o dia seguinte — divergindo do `Local::now()` usado no auto-sync.
   */
  private todayLocalDate(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  private timeToMinutes(time: string): number {
    if (!time || time.length !== 5) return -1;
    const [hours, minutes] = time.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return -1;
    return hours * 60 + minutes;
  }

  showError() {
    this.checkInError = true;

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

  validateTimeInputs(): void {
    const checkIn = this.checkInInput?.nativeElement.value || '';
    const checkOut = this.checkOutInput?.nativeElement.value || '';
    const checkIn2 = this.checkIn2Input?.nativeElement.value || '';

    const checkInMinutes = this.timeToMinutes(checkIn);
    const checkOutMinutes = this.timeToMinutes(checkOut);
    const checkIn2Minutes = this.timeToMinutes(checkIn2);

    this.clearTimeErrors();

    const errors: Array<{ field: 'checkIn' | 'checkOut' | 'checkIn2'; message: string }> = [];

    if (checkIn.length > 0 && checkInMinutes === -1) {
      errors.push({ field: 'checkIn', message: 'Formato de horário de entrada inválido' });
    }

    if (checkOut.length > 0 && checkOutMinutes === -1) {
      errors.push({ field: 'checkOut', message: 'Formato de horário de saída inválido' });
    }

    if (checkIn2.length > 0 && checkIn2Minutes === -1) {
      errors.push({ field: 'checkIn2', message: 'Formato de horário de retorno inválido' });
    }

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
      this.capturedCheckOut2 = '';

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

  /**
   * @param skipSessionWait Pula a espera por `sessionRestorePromise`. Usado quando chamado
   * de dentro de `restoreSessionFromStorage` (importação automática ao iniciar), onde
   * aguardar essa mesma promise causaria deadlock.
   */
  async onImportClick(skipSessionWait = false): Promise<WorkDaysResponse | null> {
    if (this.isImporting) return null;

    try {
      this.isImporting = true;

      if (!skipSessionWait) {
        // Aguarda restauração de sessão caso ainda esteja em andamento
        await this.sessionRestorePromise;
      }

      if (!this.isPontomaisLoggedIn) {
        this.toastService.error('Conecte-se a uma conta para importar os registros de ponto', 3000);
        return null;
      }

      const today = this.todayLocalDate();
      const workDay = await this.pontoMaisService.getCurrentWorkDay(today);
      const imported = this.applyImportedCards(workDay);

      // Só o caso vazio avisa: quando há registros, eles próprios aparecem nos
      // campos e nas métricas — um toast repetiria o que a tela já mostrou.
      if (imported === 0) {
        this.toastService.error('Nenhum registro encontrado para hoje', 3000);
      }

      return workDay;
    } catch (error) {
      if (error === 'SESSION_EXPIRED') {
        await this.handleSessionExpired();
      } else {
        console.error('Erro ao importar:', error);
        this.toastService.error('Erro ao importar horários', 3000);
      }

      return null;
    } finally {
      this.isImporting = false;
    }
  }

  onSettingsClick(): void {
    this.showSettingsModal = true;
  }

  private async checkForUpdateSilently(): Promise<void> {
    try {
      const update = await this.updateService.checkForUpdate();

      const settings = await invoke<AppSettings>('load_settings');
      settings.lastUpdateCheck = new Date().toISOString();
      settings.lastUpdateResult = update ? 'available' : 'up-to-date';
      settings.lastUpdateVersion = update?.version ?? '';

      await invoke('save_settings', { settings });
    } catch (error) {
      console.error('Erro ao verificar atualizações na inicialização:', error);

      try {
        const settings = await invoke<AppSettings>('load_settings');
        settings.lastUpdateCheck = new Date().toISOString();
        settings.lastUpdateResult = 'error';
        settings.lastUpdateVersion = '';

        await invoke('save_settings', { settings });
      } catch (saveError) {
        console.error('Erro ao registrar falha da verificação:', saveError);
      }
    }
  }

  async onCloseSettingsModal(): Promise<void> {
    this.showSettingsModal = false;
    // Recarregar estado após fechar configurações (usuário pode ter alterado auto-sync ou feito logout)
    this.isPontomaisLoggedIn = await this.credentialsService.hasToken();
    try {
      const settings = await invoke<{
        autoImportEnabled: boolean;
        autoImportInterval: number;
        importOnStartupEnabled: boolean;
        expectedWorkdayMinutes: number;
        defaultBreakMinutes: number;
      }>('load_settings');
      this.autoImportEnabled = settings.autoImportEnabled;
      this.autoImportInterval = settings.autoImportInterval;
      this.importOnStartupEnabled = settings.importOnStartupEnabled;

      // Jornada e intervalo mudam o tempo restante e o fim do expediente: sem
      // recalcular aqui, as métricas ficariam nos valores antigos até a próxima
      // batida.
      this.expectedWorkdayMinutes = settings.expectedWorkdayMinutes;
      this.defaultBreakMinutes = settings.defaultBreakMinutes;
      if (this.isMonitoring) {
        this.updateWorkTime();
      }
    } catch {}
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

    if (this.autoSyncUnlisten) {
      this.autoSyncUnlisten();
    }
  }
}
