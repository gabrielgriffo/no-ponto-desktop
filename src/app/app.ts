import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HoverResetService } from './services/hover-reset.service';
import { Toast } from './components/toast/toast';
import { Onboarding } from './pages/onboarding/onboarding';
import { OnboardingService } from './pages/onboarding/onboarding.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toast, Onboarding],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly onboarding = inject(OnboardingService);

  constructor() {
    inject(HoverResetService).init().catch(() => {});
    this.onboarding.decide();
  }
}
