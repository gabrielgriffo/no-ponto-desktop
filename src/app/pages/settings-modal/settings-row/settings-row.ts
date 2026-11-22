import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsRow {
  readonly icon = input('');
  readonly label = input('');
  readonly description = input('');
  readonly value = input('');
  readonly badge = input('');
  readonly dot = input(false);
  readonly showValueTooltip = input(true);

  readonly action = output<void>();
}
