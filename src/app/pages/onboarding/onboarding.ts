import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { IntegrationSettingsComponent } from '../settings-modal/integration-settings/integration-settings';
import { SyncSettingsComponent } from '../settings-modal/screens/sync-settings/sync-settings';
import { AlertsSettingsComponent } from '../settings-modal/screens/alerts-settings/alerts-settings';
import { ExternalAppSettingsComponent } from '../settings-modal/screens/external-app-settings/external-app-settings';
import { StartupSettingsComponent } from '../settings-modal/screens/startup-settings/startup-settings';
import { SettingsPatch } from '../settings-modal/settings.model';
import { SettingsActionsService } from '../../services/settings-actions.service';
import { WindowService } from '../../services/window.service';
import { OnboardingService } from './onboarding.service';
import {
  OnboardingStep,
  SKIP_ACCOUNT,
  STEP_TEXT,
  onboardingSteps,
  resumeStep,
  skipAllImpact,
  stepAfter,
  stepBefore,
} from './onboarding-plan';

@Component({
  selector: 'app-onboarding',
  imports: [
    IntegrationSettingsComponent,
    SyncSettingsComponent,
    AlertsSettingsComponent,
    ExternalAppSettingsComponent,
    StartupSettingsComponent,
  ],
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class Onboarding {
  private readonly actions = inject(SettingsActionsService);
  private readonly onboarding = inject(OnboardingService);
  private readonly windowService = inject(WindowService);

  protected readonly settings = this.actions.settings;
  protected readonly loggedIn = computed(() => this.settings().isPontomaisLoggedIn);
  protected readonly steps = computed(() => onboardingSteps(this.loggedIn()));
  private readonly requestedStep = signal<OnboardingStep>(resumeStep(this.settings().isPontomaisLoggedIn));
  protected readonly step = computed(() =>
    this.steps().includes(this.requestedStep()) ? this.requestedStep() : resumeStep(this.loggedIn())
  );
  protected readonly text = computed(() => STEP_TEXT[this.step()]);
  protected readonly stepNumber = computed(() => this.steps().indexOf(this.step()) + 1);
  protected readonly isLast = computed(() => stepAfter(this.steps(), this.step()) === null);
  protected readonly canGoBack = computed(() => stepBefore(this.steps(), this.step()) !== null);
  protected readonly needsAccount = computed(() => this.step() === 'conta' && !this.loggedIn());


  protected readonly loaded = signal(false);
  protected readonly finishing = signal(false);
  protected readonly isLoggingIn = signal(false);
  protected readonly isLoggingOut = signal(false);
  protected readonly loginDraft = signal('');
  protected readonly passwordDraft = signal('');

  protected readonly confirmSkip = signal<'conta' | 'all' | null>(null);
  protected readonly skipImpact = computed(() => {
    const skip = this.confirmSkip();
    if (skip === 'all') return skipAllImpact(this.loggedIn());
    return skip === 'conta' ? SKIP_ACCOUNT : null;
  });

  private readonly skipConfirmButton = viewChild<ElementRef<HTMLButtonElement>>('skipConfirm');

  constructor() {
    this.load();
    afterNextRender(() => {
      invoke('main_window_ready').catch(() => {});
    });

    effect(() => {
      const button = this.skipConfirmButton();
      if (button) setTimeout(() => button.nativeElement.focus());
    });

    const destroyRef = inject(DestroyRef);
    listen('session-expired', () => this.refreshAccount()).then(unlisten => {
      if (destroyRef.destroyed) unlisten();
      else destroyRef.onDestroy(unlisten);
    });
  }

  private async refreshAccount(): Promise<void> {
    try {
      await this.actions.loadAndReconcile();
    } catch (error) {
      console.error('Erro ao atualizar a conta:', error);
    }
  }

  private async load(): Promise<void> {
    try {
      await this.actions.loadAndReconcile();
    } catch (error) {
      console.error('Erro ao carregar configurações:', error);
    }
    this.loginDraft.set(this.settings().pontomaisLogin);
    if (this.loggedIn() && this.step() === 'conta') this.requestedStep.set(resumeStep(true));
    this.loaded.set(true);
  }

  protected applyPatch(patch: SettingsPatch): void {
    this.actions.applyPatch(patch);
  }

  protected async onSaveCredentials(): Promise<void> {
    const login = this.loginDraft().trim();
    this.isLoggingIn.set(true);
    try {
      if (await this.actions.authenticate(login, this.passwordDraft())) {
        this.loginDraft.set(login);
        this.passwordDraft.set('');
        this.next();
      }
    } finally {
      this.isLoggingIn.set(false);
    }
  }

  protected async onLogout(): Promise<void> {
    if (this.isLoggingOut()) return;
    this.isLoggingOut.set(true);
    try {
      this.passwordDraft.set('');
      await this.actions.logout();
    } finally {
      this.isLoggingOut.set(false);
    }
  }

  protected next(): void {
    const following = stepAfter(this.steps(), this.step());
    if (following) {
      this.requestedStep.set(following);
    } else {
      this.finish();
    }
  }

  protected back(): void {
    const previous = stepBefore(this.steps(), this.step());
    if (previous) this.requestedStep.set(previous);
  }

  protected askSkip(skip: 'conta' | 'all'): void {
    this.confirmSkip.set(skip);
  }

  protected skipStep(): void {
    if (this.needsAccount()) {
      this.askSkip('conta');
    } else {
      this.next();
    }
  }

  protected onEscape(): void {
    if (this.confirmSkip()) {
      this.cancelSkip();
    } else if (!this.isLoggingIn() && !this.finishing()) {
      this.askSkip('all');
    }
  }

  protected cancelSkip(): void {
    this.confirmSkip.set(null);
  }

  protected confirmSkipStep(): void {
    const skip = this.confirmSkip();
    this.confirmSkip.set(null);
    if (skip === 'all') {
      this.finish();
    } else if (skip === 'conta') {
      this.next();
    }
  }

  protected async finish(): Promise<void> {
    if (this.finishing() || this.isLoggingIn()) return;
    this.finishing.set(true);
    this.passwordDraft.set('');
    await this.onboarding.finish();
  }

  protected minimize(): void {
    this.windowService.minimize();
  }

  protected close(): void {
    this.windowService.close();
  }
}
