import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-tooltip-content',
  templateUrl: './tooltip.html',
  styleUrl: './tooltip.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TooltipComponent {
  text = input.required<string>();
  position = input<'top' | 'bottom' | 'left' | 'right'>('top');
  isVisible = input<boolean>(false);
  arrowLeft = input<string>('50%');
}
