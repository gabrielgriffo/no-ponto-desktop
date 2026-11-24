import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { SettingsModal } from '../settings-modal/settings-modal';
import { FlipText } from '../../components/flip-text/flip-text';
import { TooltipDirective } from '../../directives/tooltip.directive';
import { TimeFormatPipe } from '../../pipes/time-format.pipe';
import { TimeInputDirective } from '../../directives/time-input.directive';
import {
  TimeCalculationService,
  DEFAULT_JOURNEY_MINUTES,
  WorkTimeResult,
} from '../../services/time-calculation.service';
import { formatDurationLong, formatIntervalShort } from '../settings-modal/settings.model';
import { UpdateService } from '../../services/update.service';
import { WindowService } from '../../services/window.service';
import { TimeObject } from '../../models/time-object';
import { TimeUtilsService } from '../../services/time-utils.service';
import { ToastService } from '../../services/toast.service';
import { PontoMaisService, TimeCard, WorkDaysResponse } from '../../services/pontomais.service';
import { SettingsStore } from '../../services/settings.store';
import { AutoSyncService } from '../../services/auto-sync.service';
import {
  AlarmService,
  JourneyState,
  WORKDAY_END_TITLE,
  closedDayState,
  isWorkdayReopened,
  shouldRingAlarm,
  workdayEndMessage,
} from '../../services/alarm.service';
import { AlarmBanner } from '../../components/alarm-banner/alarm-banner';
import { UpdateButton } from '../../components/update-button/update-button';
import { hasTimeCards, isTodayLocal, todayLocalDate, validTimeCards } from '../../models/work-day';
import { TimeField, validateTimes } from './time-validation';

const STARTUP_IMPORT_RETRY_MS = 5 * 60_000;
const SIGNED_OUT = 'SIGNED_OUT';
const VAULT_UNAVAILABLE = 'VAULT_UNAVAILABLE';
const STARTUP_IMPORT_MAX_RETRIES = 3;
const SESSION_RESTORE_RETRY_MS = 60_000;
const SESSION_RESTORE_MAX_RETRIES = 3;
const UPDATE_CHECK_RETRY_MS = 10 * 60_000;
const UPDATE_CHECK_MAX_RETRIES = 3;
const ERROR_HIGHLIGHT_MS = 3000;

const ZERO: TimeObject = { hours: 0, minutes: 0 };
const IDLE_METRICS: WorkTimeResult = {
  firstPeriod: ZERO,
  secondPeriod: ZERO,
  workedTime: ZERO,
  remainingTime: ZERO,
  endTime: ZERO,
  lunchHourAdded: false,
};

const toMinutes = (time: TimeObject) => time.hours * 60 + time.minutes;
const percentOf = (time: TimeObject, total: number) => Math.min((toMinutes(time) / total) * 100, 100);

const sameMetrics = (a: WorkTimeResult, b: WorkTimeResult) =>
  a.lunchHourAdded === b.lunchHourAdded &&
  (['firstPeriod', 'secondPeriod', 'workedTime', 'remainingTime', 'endTime'] as const).every(
    key => toMinutes(a[key]) === toMinutes(b[key])
  );

interface CapturedTimes {
  checkIn: string;
  checkOut: string;
  checkIn2: string;
  checkOut2: string;
  extras: string[];
}

const NO_CAPTURE: CapturedTimes = { checkIn: '', checkOut: '', checkIn2: '', checkOut2: '', extras: [] };

interface AutoSyncPayload {
  status: 'success' | 'error' | 'unauthenticated';
  data?: WorkDaysResponse;
  date?: string;
  message?: string;
}

const countCards = ({ checkIn, checkOut, checkIn2, checkOut2, extras }: CapturedTimes) =>
  [checkIn, checkOut, checkIn2, checkOut2].filter(time => time.length > 0).length + extras.length;

@Component({
  selector: 'app-home',
  imports: [SettingsModal, FlipText, TooltipDirective, TimeFormatPipe, TimeInputDirective, AlarmBanner, UpdateButton],
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-state]': 'journeyState()' },
})
export class Home implements OnInit, OnDestroy {
  private readonly timeCalc = inject(TimeCalculationService);
  private readonly timeUtils = inject(TimeUtilsService);
  private readonly windowService = inject(WindowService);
  private readonly toastService = inject(ToastService);
  private readonly pontoMaisService = inject(PontoMaisService);
  private readonly updateService = inject(UpdateService);
  private readonly alarmService = inject(AlarmService);
  private readonly settingsStore = inject(SettingsStore);
  private readonly autoSync = inject(AutoSyncService);

  private readonly checkInInput = viewChild.required<ElementRef<HTMLInputElement>>('checkInInput');
  private readonly checkOutInput = viewChild.required<ElementRef<HTMLInputElement>>('checkOutInput');
  private readonly checkIn2Input = viewChild.required<ElementRef<HTMLInputElement>>('checkIn2Input');
  private readonly settingsModal = viewChild(SettingsModal);

  protected readonly showSettingsModal = signal(false);
  protected readonly isMonitoring = signal(false);
  protected readonly isPontomaisLoggedIn = signal(false);
  protected readonly isImporting = signal(false);
  protected readonly errorFields = signal<ReadonlySet<TimeField>>(new Set());
  protected readonly metrics = signal(IDLE_METRICS, { equal: sameMetrics });

  private readonly captured = signal(NO_CAPTURE);
  private readonly workdayEndNotifiedOn = signal('');

  private readonly settings = this.settingsStore.settings;
  protected readonly autoImportEnabled = computed(() => this.settings().autoImportEnabled);
  protected readonly alarmEnabled = computed(() => this.settings().alarmEnabled);
  protected readonly notificationEnabled = computed(() => this.settings().notificationEnabled);
  protected readonly isSyncEnabled = computed(
    () => this.settings().autoImportEnabled || this.settings().smartSyncEnabled
  );
  private readonly journeyMinutes = computed(() => {
    const minutes = this.settings().expectedWorkdayMinutes;
    return minutes > 0 ? minutes : DEFAULT_JOURNEY_MINUTES;
  });
  private readonly breakMinutes = computed(() => this.settings().defaultBreakMinutes);

  protected readonly hasFirstPeriod = computed(() => this.captured().checkIn.length > 0);
  protected readonly hasSecondPeriod = computed(() => this.captured().checkIn2.length > 0);
  private readonly closedDay = computed(() =>
    closedDayState(countCards(this.captured()), toMinutes(this.metrics().workedTime), this.journeyMinutes())
  );
  protected readonly isWorkDayComplete = computed(() => this.closedDay() === 'terminou');
  protected readonly isOnBreak = computed(() => this.closedDay() === 'pausado');
  private readonly journeyTargetMinutes = computed(() => {
    const breakPending = this.hasFirstPeriod() && this.captured().checkOut.length === 0;
    return breakPending ? this.journeyMinutes() + Math.max(0, this.breakMinutes()) : this.journeyMinutes();
  });

  protected readonly journeyState = computed<JourneyState>(() => {
    if (this.isWorkDayComplete()) return 'terminou';
    if (this.isOnBreak()) return 'pausado';
    const worked = toMinutes(this.metrics().workedTime);
    if (this.isMonitoring() && worked >= this.journeyTargetMinutes()) return 'extra';
    return 'andamento';
  });

  protected readonly progressPercentage = computed(() => percentOf(this.metrics().workedTime, this.journeyMinutes()));
  protected readonly progressLabel = computed(() => this.progressPercentage().toFixed(1).replace('.', ','));
  protected readonly firstPeriodPercentage = computed(() => percentOf(this.metrics().firstPeriod, this.journeyMinutes()));
  protected readonly secondPeriodPercentage = computed(() => percentOf(this.metrics().secondPeriod, this.journeyMinutes()));

  protected readonly lunchHourTooltip = computed(
    () => `O cálculo foi ajustado para incluir ${formatDurationLong(this.breakMinutes())} de intervalo`
  );

  private readonly trayStatusLabel = computed(() => {
    if (!this.isMonitoring()) return 'Monitoramento parado';
    switch (this.journeyState()) {
      case 'terminou': return 'Saída final do dia registrada';
      case 'pausado': return 'Saída registrada, aguardando o retorno';
      case 'extra': return 'Jornada atingida, sem a saída final';
      default: return 'Expediente em curso';
    }
  });

  protected readonly autoSyncTooltip = computed(() => {
    if (!this.isSyncEnabled()) return 'Sincronização automática desativada';
    if (!this.isPontomaisLoggedIn()) return 'Conecte-se a uma conta para ativar a sincronização';
    if (this.settings().smartSyncEnabled) return 'Sincronização inteligente ativada';
    return `Sincronização automática a cada ${formatDurationLong(this.settings().autoImportInterval)}`;
  });
  protected readonly autoSyncIntervalLabel = computed(() => formatIntervalShort(this.settings().autoImportInterval));
  protected readonly alarmTooltip = computed(() =>
    this.alarmEnabled() ? 'Alarme ativado para o fim do expediente' : 'Alarme desativado'
  );
  protected readonly notificationTooltip = computed(() =>
    this.notificationEnabled() ? 'Notificações ativadas para o fim do expediente' : 'Notificações desativadas'
  );

  protected readonly nextAlarmTime = computed<TimeObject | null>(() => {
    if (!this.alarmEnabled() || !this.isMonitoring()) return null;

    const snoozedUntil = this.alarmService.snoozedUntil();
    if (snoozedUntil) {
      return { hours: snoozedUntil.getHours(), minutes: snoozedUntil.getMinutes() };
    }

    if (this.workdayEndNotifiedOn() === todayLocalDate()) return null;

    const state = this.journeyState();
    if (state === 'extra' || state === 'terminou') return null;
    if (toMinutes(this.metrics().workedTime) >= this.journeyTargetMinutes()) return null;
    return this.metrics().endTime;
  });

  private previousJourneyState: JourneyState | null = null;
  private monitoringDate = '';
  private importedInputs = '';
  private importedCheckOut2 = '';
  private importedExtras: string[] = [];
  private updateInterval?: ReturnType<typeof setInterval>;
  private errorTimer?: ReturnType<typeof setTimeout>;
  private startupImportRetryTimer?: ReturnType<typeof setTimeout>;
  private sessionRestoreRetryTimer?: ReturnType<typeof setTimeout>;
  private updateCheckRetryTimer?: ReturnType<typeof setTimeout>;
  private pendingSyncPayload: AutoSyncPayload | null = null;
  private sessionRestorePromise?: Promise<void>;
  private autoSyncUnlisten?: UnlistenFn;
  private sessionExpiredUnlisten?: UnlistenFn;
  private readonly removeFocusListeners: (() => void)[] = [];

  constructor() {
    effect(() => {
      const status = this.trayStatusLabel();
      const state = this.isMonitoring() ? this.journeyState() : null;
      invoke('set_tray_status', { status, state }).catch(() => {});
    });

    effect(() => {
      if (!this.alarmEnabled()) untracked(() => this.alarmService.dismiss());
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      const settings = await this.settingsStore.load();
      this.isPontomaisLoggedIn.set(settings.isPontomaisLoggedIn);
      if (settings.autoImportEnabled && settings.smartSyncEnabled) {
        await this.turnOffAutoSyncInFavorOfSmart();
      }
    } catch (error) {
      console.error('Erro ao carregar configurações:', error);
    }

    // Registrar listener ANTES de restaurar sessão para não perder eventos iniciais.
    this.autoSyncUnlisten = await listen<AutoSyncPayload>('auto-sync-result', event =>
      this.onAutoSyncResult(event.payload)
    );
    this.sessionExpiredUnlisten = await listen('session-expired', () => this.handleSessionExpired());

    // onImportClick aguarda essa promise antes de executar
    this.sessionRestorePromise = this.restoreSessionFromStorage();

    this.checkForUpdateSilently();
    this.listenForFocusRemoval();
  }

  ngOnDestroy(): void {
    this.alarmService.dismiss();
    this.cancelStartupImportRetry();
    clearTimeout(this.sessionRestoreRetryTimer);
    clearTimeout(this.updateCheckRetryTimer);
    clearInterval(this.updateInterval);
    clearTimeout(this.errorTimer);
    this.removeFocusListeners.forEach(remove => remove());
    this.autoSyncUnlisten?.();
    this.sessionExpiredUnlisten?.();
  }

  private listenForFocusRemoval(): void {
    const removeFocus = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active?.blur && active.tagName !== 'INPUT') active.blur();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) setTimeout(removeFocus, 100);
    };

    let canRemoveFocus = true;
    const onMouseMove = () => {
      if (!canRemoveFocus) return;
      removeFocus();
      canRemoveFocus = false;
      setTimeout(() => (canRemoveFocus = true), 500);
    };

    const onFocusOut = () => setTimeout(() => this.applyPendingSync());

    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('focusout', onFocusOut);
    this.removeFocusListeners.push(
      () => document.removeEventListener('visibilitychange', onVisibilityChange),
      () => document.removeEventListener('mousemove', onMouseMove),
      () => document.removeEventListener('focusout', onFocusOut)
    );
  }

  private isEditingTimes(): boolean {
    const active = document.activeElement;
    return [this.checkInInput(), this.checkOutInput(), this.checkIn2Input()].some(
      input => input.nativeElement === active
    );
  }

  private applyPendingSync(): void {
    const payload = this.pendingSyncPayload;
    if (!payload || this.isEditingTimes()) return;
    this.pendingSyncPayload = null;
    this.onAutoSyncResult(payload);
  }

  private async restoreSessionFromStorage(retriesLeft = SESSION_RESTORE_MAX_RETRIES): Promise<void> {
    this.sessionRestoreRetryTimer = undefined;
    try {
      const status = await this.pontoMaisService.ensureSession();

      if (status === 'signedOut') {
        this.isPontomaisLoggedIn.set(false);
        return;
      }

      this.isPontomaisLoggedIn.set(true);

      const settings = this.settings();
      await this.autoSync.apply(settings, true);

      // Importar horários automaticamente ao iniciar, se habilitado.
      // Chama onImportClick diretamente para reaproveitar o feedback visual
      // (spinner/toast) e o guard de isImporting, evitando clique duplicado
      // enquanto a importação automática está em andamento. Pula a espera pela
      // sessão pois já estamos dentro dela (evita deadlock com sessionRestorePromise).
      if (settings.importOnStartupEnabled && !this.isSyncEnabled()) {
        const workDay = await this.onImportClick(true);

        if (workDay) {
          await invoke('external_app_maybe_launch', { workDay, date: todayLocalDate() });
        }

        if (!hasTimeCards(workDay)) {
          this.scheduleStartupImportRetry(STARTUP_IMPORT_MAX_RETRIES);
        }
      }
    } catch (error) {
      console.error('Erro ao restaurar sessão:', error);
      // Não deu para ler o cofre. A conta continua vinculada — a próxima busca dirá se
      // a sessão vale —, mas o usuário precisa saber que o app subiu sem sessão em vez
      // de descobrir sozinho quando a importação não trouxer nada.
      if (retriesLeft === SESSION_RESTORE_MAX_RETRIES) {
        this.toastService.error('Não foi possível restaurar a sessão. Tente importar novamente.', 5000);
      }
      if (retriesLeft > 0) {
        this.sessionRestoreRetryTimer = setTimeout(
          () => this.restoreSessionFromStorage(retriesLeft - 1),
          SESSION_RESTORE_RETRY_MS
        );
      }
    }
  }

  private cancelSessionRestoreRetry(): void {
    clearTimeout(this.sessionRestoreRetryTimer);
    this.sessionRestoreRetryTimer = undefined;
  }

  /**
   * O Ponto Mais leva alguns minutos para disponibilizar uma batida recém-feita. Sem
   * sincronização ligada, a importação ao iniciar é a única chance do dia: se ela não
   * encontrou registro (ou falhou porque a rede ainda não subiu), tenta de novo.
   */
  private scheduleStartupImportRetry(retriesLeft: number): void {
    this.cancelStartupImportRetry();
    if (retriesLeft <= 0 || this.isSyncEnabled()) return;

    this.startupImportRetryTimer = setTimeout(
      () => this.retryStartupImport(retriesLeft - 1),
      STARTUP_IMPORT_RETRY_MS
    );
  }

  private cancelStartupImportRetry(): void {
    clearTimeout(this.startupImportRetryTimer);
    this.startupImportRetryTimer = undefined;
  }

  private async retryStartupImport(retriesLeft: number): Promise<void> {
    this.startupImportRetryTimer = undefined;
    if (this.isSyncEnabled() || !this.isPontomaisLoggedIn()) return;

    try {
      const date = todayLocalDate();
      const workDay = await this.fetchWorkDay(date);

      if (hasTimeCards(workDay) && isTodayLocal(date)) {
        this.applyImportedCards(workDay);
        await invoke('external_app_maybe_launch', { workDay, date });
        return;
      }
    } catch (error) {
      if (error === 'SESSION_EXPIRED') {
        await this.handleSessionExpired();
        return;
      }
      console.warn('[startup-import] Erro na nova tentativa:', error);
    }

    this.scheduleStartupImportRetry(retriesLeft);
  }

  private onAutoSyncResult(payload: AutoSyncPayload): void {
    if (payload.status === 'success' && payload.data) {
      if (payload.date && !isTodayLocal(payload.date)) return;
      if (this.isEditingTimes()) {
        this.pendingSyncPayload = payload;
        return;
      }
      this.pendingSyncPayload = null;
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

  /**
   * A sessão morreu e o Rust já desvinculou a conta: zerou o estado, apagou o cofre,
   * gravou `isPontomaisLoggedIn: false` e trouxe a janela para frente. Aqui sobra
   * só o que é da tela.
   */
  private async handleSessionExpired(): Promise<void> {
    if (!this.isPontomaisLoggedIn()) return;
    this.isPontomaisLoggedIn.set(false);

    await this.autoSync.apply(this.settings(), false);

    this.toastService.error('Sessão expirada. Faça login novamente nas configurações.', 5000);
  }

  private applyImportedCards(workDay: WorkDaysResponse): number {
    const cards = validTimeCards(workDay);
    if (!cards.length) return 0;

    const format = (card?: TimeCard) => (card ? this.timeUtils.formatTimeInput(card.time) : '');
    this.checkInInput().nativeElement.value = format(cards[0]);
    this.checkOutInput().nativeElement.value = format(cards[1]);
    this.checkIn2Input().nativeElement.value = format(cards[2]);

    this.importedInputs = this.currentInputs();
    this.importedCheckOut2 = format(cards[3]);
    this.importedExtras = cards.slice(4).map(card => format(card));
    this.onStartMonitoringClick();
    return Math.min(cards.length, 3);
  }

  private updateWorkTime(): void {
    if (this.isMonitoring() && this.monitoringDate !== todayLocalDate()) {
      this.importedInputs = '';
      this.importedCheckOut2 = '';
      this.importedExtras = [];
      this.clearInputs();
      this.stopMonitoring();
      return;
    }

    const { checkIn, checkOut, checkIn2, checkOut2, extras } = this.captured();
    this.metrics.set(
      this.timeCalc.calculateWorkTime(
        checkIn,
        checkOut,
        checkIn2,
        checkOut2,
        this.journeyMinutes(),
        this.breakMinutes(),
        extras
      )
    );
    this.checkAlarm();
  }

  private checkAlarm(): void {
    if (!this.isMonitoring()) return;
    const previous = this.previousJourneyState;
    const current = this.journeyState();
    this.previousJourneyState = current;

    if (isWorkdayReopened(previous, current, toMinutes(this.metrics().workedTime), this.journeyTargetMinutes())) {
      this.workdayEndNotifiedOn.set('');
      this.alarmService.dismiss();
      return;
    }

    if (current === 'terminou' && previous !== 'terminou') {
      this.alarmService.dismiss();
      return;
    }

    if (!shouldRingAlarm(previous, current)) return;

    const settings = this.settings();
    if (!settings.alarmEnabled && !settings.notificationEnabled) return;

    const today = todayLocalDate();
    if (this.workdayEndNotifiedOn() === today) return;
    this.workdayEndNotifiedOn.set(today);

    if (settings.alarmEnabled) {
      this.alarmService.ring({
        sound: settings.alarmSound,
        volume: settings.alarmVolume,
        mode: settings.alarmMode,
        durationSeconds: settings.alarmDurationSeconds,
        journeyMinutes: this.journeyMinutes(),
      });
    }

    if (settings.notificationEnabled) {
      invoke('notify_workday_end', {
        title: WORKDAY_END_TITLE,
        body: workdayEndMessage(this.journeyMinutes()),
      }).catch(() => {});
    }
  }

  private async turnOffAutoSyncInFavorOfSmart(): Promise<void> {
    try {
      await this.settingsStore.update({ autoImportEnabled: false });
    } catch (error) {
      console.error('Erro ao desligar a sincronização automática:', error);
    }
    this.toastService.info('A sincronização automática foi desligada: ela não funciona junto com a inteligente', 5000);
  }

  protected hasError(field: TimeField): boolean {
    return this.errorFields().has(field);
  }

  protected clearTimeErrors(): void {
    this.errorFields.set(new Set());
    clearTimeout(this.errorTimer);
    this.errorTimer = undefined;
  }

  private validateTimeInputs(): boolean {
    const { fields, message } = validateTimes(
      this.checkInInput().nativeElement.value,
      this.checkOutInput().nativeElement.value,
      this.checkIn2Input().nativeElement.value
    );

    this.clearTimeErrors();
    if (fields.length === 0) return true;

    this.errorFields.set(new Set(fields));
    if (message) this.toastService.error(message, ERROR_HIGHLIGHT_MS);
    this.errorTimer = setTimeout(() => this.clearTimeErrors(), ERROR_HIGHLIGHT_MS);
    return false;
  }

  protected async onMinimizeClick(): Promise<void> {
    await this.windowService.minimize();
  }

  protected async onCloseClick(): Promise<void> {
    await this.windowService.close();
  }

  protected onStartMonitoringClick(): void {
    if (!this.validateTimeInputs()) {
      this.stopMonitoring();
      return;
    }

    // A saída final não tem campo na tela: só vale se os horários ainda forem os importados.
    const keepImported = this.currentInputs() === this.importedInputs;
    this.captured.set({
      checkIn: this.checkInInput().nativeElement.value,
      checkOut: this.checkOutInput().nativeElement.value,
      checkIn2: this.checkIn2Input().nativeElement.value,
      checkOut2: keepImported ? this.importedCheckOut2 : '',
      extras: keepImported ? this.importedExtras : [],
    });
    this.monitoringDate = todayLocalDate();

    this.updateWorkTime();
    this.isMonitoring.set(true);

    clearInterval(this.updateInterval);
    this.updateInterval = setInterval(() => this.updateWorkTime(), 1000);
  }

  private currentInputs(): string {
    return [this.checkInInput(), this.checkOutInput(), this.checkIn2Input()]
      .map(input => input.nativeElement.value)
      .join('|');
  }

  private clearInputs(): void {
    for (const input of [this.checkInInput(), this.checkOutInput(), this.checkIn2Input()]) {
      input.nativeElement.value = '';
    }
  }

  private stopMonitoring(): void {
    clearInterval(this.updateInterval);
    this.updateInterval = undefined;
    this.isMonitoring.set(false);
    this.captured.set(NO_CAPTURE);
    this.metrics.set(IDLE_METRICS);
    this.previousJourneyState = null;
    this.alarmService.dismiss();
  }

  /**
   * @param skipSessionWait Pula a espera por `sessionRestorePromise`. Usado quando chamado
   * de dentro de `restoreSessionFromStorage` (importação automática ao iniciar), onde
   * aguardar essa mesma promise causaria deadlock.
   */
  protected async onImportClick(skipSessionWait = false): Promise<WorkDaysResponse | null> {
    if (this.isImporting()) return null;

    try {
      this.isImporting.set(true);

      if (!skipSessionWait) {
        await this.sessionRestorePromise;
      }

      if (!this.isPontomaisLoggedIn()) {
        this.toastService.error('Conecte-se a uma conta para importar os registros de ponto', 3000);
        return null;
      }

      const date = todayLocalDate();
      const workDay = await this.fetchWorkDay(date);
      if (!isTodayLocal(date)) return null;
      const imported = this.applyImportedCards(workDay);

      // Só o caso vazio avisa: quando há registros, eles próprios aparecem nos
      // campos e nas métricas — um toast repetiria o que a tela já mostrou.
      if (imported === 0) {
        this.toastService.error('Nenhum registro encontrado para hoje', 3000);
      } else {
        this.cancelStartupImportRetry();
      }

      return workDay;
    } catch (error) {
      if (error === 'SESSION_EXPIRED') {
        await this.handleSessionExpired();
      } else if (error === SIGNED_OUT) {
        this.isPontomaisLoggedIn.set(false);
        this.toastService.error('Conecte-se a uma conta para importar os registros de ponto', 3000);
      } else if (error === VAULT_UNAVAILABLE) {
        this.toastService.error('Não foi possível ler a sessão salva no sistema. Tente de novo em instantes.', 4000);
      } else if (error === 'RECONNECT_PENDING') {
        // A sessão caiu e a reconexão não foi adiante desta vez. A conta continua
        // vinculada — dizer "erro ao importar" mandaria o usuário procurar defeito no
        // lugar errado.
        this.toastService.error('Não foi possível reconectar agora. Tentando de novo em instantes.', 4000);
        this.scheduleStartupImportRetry(STARTUP_IMPORT_MAX_RETRIES);
      } else {
        console.error('Erro ao importar:', error);
        this.toastService.error('Erro ao importar horários. Tente novamente em instantes.', 3000);
      }

      return null;
    } finally {
      this.isImporting.set(false);
    }
  }

  private async fetchWorkDay(date: string): Promise<WorkDaysResponse> {
    try {
      return await this.pontoMaisService.getCurrentWorkDay(date);
    } catch (error) {
      if (error !== 'NOT_AUTHENTICATED') throw error;
    }

    let status;
    try {
      status = await this.pontoMaisService.ensureSession();
    } catch {
      throw VAULT_UNAVAILABLE;
    }
    if (status !== 'connected') throw SIGNED_OUT;

    this.cancelSessionRestoreRetry();
    this.isPontomaisLoggedIn.set(true);
    await this.autoSync.apply(this.settings(), true).catch(error =>
      console.error('Erro ao configurar a sincronização:', error)
    );
    return await this.pontoMaisService.getCurrentWorkDay(date);
  }

  protected onSettingsClick(): void {
    if (this.showSettingsModal()) {
      this.settingsModal()?.resetToRootScreen();
      return;
    }

    this.showSettingsModal.set(true);
  }

  private async checkForUpdateSilently(retriesLeft = UPDATE_CHECK_MAX_RETRIES): Promise<void> {
    this.updateCheckRetryTimer = undefined;
    let patch;
    try {
      const update = await this.updateService.check();
      patch = {
        lastUpdateResult: update ? 'available' : 'up-to-date',
        lastUpdateVersion: update?.version ?? '',
      } as const;
    } catch (error) {
      console.error('Erro ao verificar atualizações na inicialização:', error);
      patch = { lastUpdateResult: 'error', lastUpdateVersion: '' } as const;
      if (retriesLeft > 0) {
        this.updateCheckRetryTimer = setTimeout(
          () => this.checkForUpdateSilently(retriesLeft - 1),
          UPDATE_CHECK_RETRY_MS
        );
      }
    }

    try {
      await this.settingsStore.update({ ...patch, lastUpdateCheck: new Date().toISOString() });
    } catch (error) {
      console.error('Erro ao registrar a verificação de atualização:', error);
    }
  }

  protected async onCloseSettingsModal(): Promise<void> {
    this.showSettingsModal.set(false);
    // Recarregar estado após fechar configurações (usuário pode ter alterado auto-sync ou feito logout)
    let sessionKnown = true;
    try {
      this.isPontomaisLoggedIn.set((await this.pontoMaisService.ensureSession()) === 'connected');
    } catch (error) {
      console.error('Erro ao restaurar sessão:', error);
      sessionKnown = false;
    }

    if (this.isSyncEnabled() || !this.isPontomaisLoggedIn()) {
      this.cancelStartupImportRetry();
    }

    if (sessionKnown) {
      await this.autoSync.apply(this.settings(), this.isPontomaisLoggedIn()).catch(error =>
        console.error('Erro ao configurar a sincronização:', error)
      );
    }

    // Jornada e intervalo mudam o tempo restante e o fim do expediente: sem
    // recalcular aqui, as métricas ficariam nos valores antigos até a próxima
    // batida.
    if (this.isMonitoring()) {
      this.updateWorkTime();
    }
  }
}
