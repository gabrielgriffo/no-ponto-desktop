import { Injectable, inject, signal } from '@angular/core';
import { SettingsStore } from '../../services/settings.store';
import { AutoSyncService } from '../../services/auto-sync.service';
import { ToastService } from '../../services/toast.service';
import { onboardingDecision } from './onboarding-plan';

export type OnboardingStatus = 'checking' | 'active' | 'off';

@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private readonly store = inject(SettingsStore);
  private readonly autoSync = inject(AutoSyncService);
  private readonly toastService = inject(ToastService);
  private readonly state = signal<OnboardingStatus>('checking');

  readonly status = this.state.asReadonly();

  async decide(): Promise<void> {
    let settings;
    try {
      settings = await this.store.load();
    } catch (error) {
      console.error('Erro ao carregar configurações para a configuração inicial:', error);
      this.state.set('off');
      return;
    }

    switch (onboardingDecision(settings.onboardingState, settings.isPontomaisLoggedIn)) {
      case 'show':
        this.state.set('active');
        if (settings.onboardingState === '') await this.save('pending');
        return;
      case 'existing-user':
        this.state.set('off');
        await this.save('done');
        return;
      case 'hide':
        this.state.set('off');
    }
  }

  async finish(): Promise<void> {
    if (!(await this.save('done'))) {
      this.toastService.error('Não foi possível salvar a configuração inicial; ela vai aparecer de novo na próxima abertura');
    }
    await this.autoSync.reset();
    this.state.set('off');
  }

  private async save(onboardingState: 'pending' | 'done'): Promise<boolean> {
    try {
      await this.store.update({ onboardingState });
      return true;
    } catch (error) {
      console.error('Erro ao salvar o progresso da configuração inicial:', error);
      return false;
    }
  }
}
