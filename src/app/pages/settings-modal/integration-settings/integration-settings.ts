import { Component, Input, Output, EventEmitter, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TooltipDirective } from '../../../directives/tooltip.directive';
import { ToggleSwitch } from '../../../components/toggle-switch/toggle-switch';

export interface IntegrationSettings {
  pontomaisLogin: string;
  pontomaisPassword: string;
  isLoggedIn: boolean;
}

@Component({
  selector: 'app-integration-settings',
  imports: [NgTemplateOutlet, FormsModule, TooltipDirective, ToggleSwitch],
  templateUrl: './integration-settings.html',
  styleUrl: './integration-settings.css',
})
export class IntegrationSettingsComponent implements AfterViewInit {
  @Input() settings!: IntegrationSettings;
  @Input() isLoggingIn: boolean = false;
  @Input() savePassword: boolean = false;
  @Output() saveCredentials = new EventEmitter<void>();
  @Output() logout = new EventEmitter<void>();
  @Output() savePasswordChange = new EventEmitter<boolean>();

  @ViewChild('loginInput') loginInput?: ElementRef<HTMLInputElement>;

  showPassword: boolean = false;

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

  onSavePasswordChange(enabled: boolean): void {
    this.savePassword = enabled;
    this.savePasswordChange.emit(enabled);
  }
}
