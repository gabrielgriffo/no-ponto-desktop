import { Component, Input, Output, EventEmitter } from '@angular/core';
import { TooltipDirective } from '../../../directives/tooltip.directive';

/**
 * O valor aparece só quando há o que dizer, para a raiz não virar uma coluna de
 * "Desativado". Categoria cujo recurso ainda não existe usa `badge` no lugar do
 * valor, e nunca as duas coisas.
 */
@Component({
  selector: 'app-settings-row',
  imports: [TooltipDirective],
  templateUrl: './settings-row.html',
  styleUrl: './settings-row.css',
})
export class SettingsRow {
  @Input() icon = '';
  @Input() label = '';
  @Input() description = '';
  @Input() value = '';
  @Input() badge = '';
  @Input() dot = false;
  @Input() showValueTooltip = true;

  @Output() action = new EventEmitter<void>();
}
