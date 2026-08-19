import { Component, Input, Output, EventEmitter, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TooltipDirective } from '../../../directives/tooltip.directive';

export interface IntegrationSettings {
  pontomaisLogin: string;
  pontomaisPassword: string;
  isLoggedIn: boolean;
}

@Component({
  selector: 'app-integration-settings',
  imports: [FormsModule, TooltipDirective],
  templateUrl: './integration-settings.html',
  styleUrl: './integration-settings.css',
})
export class IntegrationSettingsComponent implements AfterViewInit {
  @Input() settings!: IntegrationSettings;
  @Input() isLoggingIn: boolean = false;
  @Input() autoSyncEnabled: boolean = false;
  @Input() autoSyncIntervalMins: number = 10;
  @Input() importOnStartupEnabled: boolean = false;
  @Output() saveCredentials = new EventEmitter<void>();
  @Output() logout = new EventEmitter<void>();

  @ViewChild('loginInput') loginInput?: ElementRef<HTMLInputElement>;

  showPassword: boolean = false;

  /** Estado da sincronização automática exibido na nota da conta conectada. */
  get syncLabel(): string {
    if (!this.autoSyncEnabled) {
      return 'desativada';
    }

    const mins = this.autoSyncIntervalMins;
    return mins >= 60 ? `a cada ${mins / 60}h` : `a cada ${mins} min`;
  }

  get canSubmit(): boolean {
    const login = this.settings?.pontomaisLogin?.trim() ?? '';
    const password = this.settings?.pontomaisPassword ?? '';
    return !this.isLoggingIn && login.length > 0 && password.length > 0;
  }

  ngAfterViewInit(): void {
    // O usuário chegou aqui para conectar: o cursor já espera no primeiro campo
    this.loginInput?.nativeElement.focus();
  }

  onSaveCredentials(): void {
    if (!this.canSubmit) {
      return;
    }
    this.saveCredentials.emit();
  }

  onLogout(): void {
    this.logout.emit();
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }
}
