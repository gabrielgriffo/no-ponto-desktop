import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface IntegrationSettings {
  pontomaisLogin: string;
  pontomaisPassword: string;
  isLoggedIn: boolean;
}

@Component({
  selector: 'app-integration-settings',
  imports: [CommonModule, FormsModule],
  templateUrl: './integration-settings.html',
  styleUrl: './integration-settings.css',
})
export class IntegrationSettingsComponent {
  @Input() settings!: IntegrationSettings;
  @Input() isLoggingIn: boolean = false;
  @Output() saveCredentials = new EventEmitter<void>();
  @Output() logout = new EventEmitter<void>();

  showPassword: boolean = false;

  onSaveCredentials(): void {
    this.saveCredentials.emit();
  }

  onLogout(): void {
    this.logout.emit();
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }
}
