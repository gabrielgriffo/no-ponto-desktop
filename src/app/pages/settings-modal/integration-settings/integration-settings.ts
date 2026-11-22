import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TooltipDirective } from '../../../directives/tooltip.directive';
import { ToggleSwitch } from '../../../components/toggle-switch/toggle-switch';

@Component({
  selector: 'app-integration-settings',
  imports: [TooltipDirective, ToggleSwitch],
  templateUrl: './integration-settings.html',
  styleUrl: './integration-settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegrationSettingsComponent {
  readonly isLoggedIn = input(false);
  readonly account = input('');
  readonly login = model('');
  readonly password = model('');
  readonly isLoggingIn = input(false);
  readonly isLoggingOut = input(false);
  readonly autoReconnect = input(false);

  readonly saveCredentials = output<void>();
  readonly logout = output<void>();
  readonly autoReconnectChange = output<boolean>();

  private readonly loginInput = viewChild<ElementRef<HTMLInputElement>>('loginInput');

  protected readonly showPassword = signal(false);
  protected readonly canSubmit = computed(
    () => !this.isLoggingIn() && this.login().trim().length > 0 && this.password().length > 0
  );

  constructor() {
    // O usuário chegou aqui para conectar: o cursor já espera no primeiro campo
    afterNextRender(() => this.loginInput()?.nativeElement.focus());
  }

  protected onSaveCredentials(): void {
    if (this.canSubmit()) this.saveCredentials.emit();
  }

  protected togglePasswordVisibility(): void {
    this.showPassword.update(show => !show);
  }
}
