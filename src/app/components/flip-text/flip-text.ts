import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  afterRenderEffect,
  input,
  untracked,
  viewChild,
} from '@angular/core';

@Component({
  selector: 'app-flip-text',
  templateUrl: './flip-text.html',
  styleUrl: './flip-text.css',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlipText {
  readonly text = input('');
  readonly fontSize = input(42);
  readonly grayPrefix = input<string>();

  private readonly flipContainer = viewChild.required<ElementRef<HTMLDivElement>>('flipContainer');
  private rendered = false;

  constructor() {
    afterRenderEffect(() => {
      const container = this.flipContainer().nativeElement;
      const fontSize = this.fontSize();
      container.style.height = `${fontSize * 1.2}px`;
      container.style.fontSize = `${fontSize}px`;
    });

    afterRenderEffect(() => {
      const text = this.text();
      untracked(() => {
        if (!text && !this.rendered) return;
        this.renderText(text, this.rendered);
        this.rendered = true;
      });
    });
  }

  private renderText(value: string, animate: boolean): void {
    const container = this.flipContainer().nativeElement;
    const fontSize = this.fontSize();
    const grayPrefix = this.grayPrefix();

    // Marca os elementos antigos para saída
    const oldWords = container.querySelectorAll('.word');

    if (animate && oldWords.length > 0) {
      oldWords.forEach((word) => {
        word.classList.add('exit');
      });
    }

    // Cria o novo elemento
    const wordWrapper = document.createElement('div');
    wordWrapper.className = 'word';

    // Verifica se deve aplicar cor cinza no prefixo
    const shouldGrayPrefix = !!grayPrefix && value.startsWith(grayPrefix);
    const grayPrefixLength = shouldGrayPrefix ? grayPrefix.length : 0;

    // Calcula valores de animação proporcionais ao fontSize
    const translateYIn = fontSize * 0.42; // ~20px para 48px
    const translateYOut = fontSize * 0.625; // ~30px para 48px
    const blurIn = fontSize * 0.208; // ~10px para 48px
    const blurOut = fontSize * 0.25; // ~12px para 48px

    // Cria cada letra
    [...value].forEach((char, index) => {
      const letter = document.createElement('span');
      letter.className = 'letter';

      // Aplica cinza no prefixo se configurado
      if (shouldGrayPrefix && index < grayPrefixLength) {
        letter.classList.add('gray');
      }

      letter.textContent = char === ' ' ? '\u00A0' : char;

      // Define delay apenas se for animado
      if (animate) {
        letter.style.animationDelay = `${index * 0.03}s`;
        // Define valores customizados de animação
        letter.style.setProperty('--translate-y-in', `${translateYIn}px`);
        letter.style.setProperty('--translate-y-out', `${translateYOut}px`);
        letter.style.setProperty('--blur-in', `${blurIn}px`);
        letter.style.setProperty('--blur-out', `${blurOut}px`);
      } else {
        // Sem animação, já mostra a letra
        letter.style.animation = 'none';
        letter.style.opacity = '1';
        letter.style.transform = 'none';
        letter.style.filter = 'none';
      }

      wordWrapper.appendChild(letter);
    });

    // Adiciona o novo elemento ao container
    container.appendChild(wordWrapper);

    // Remove os elementos antigos após a animação terminar
    if (animate && oldWords.length > 0) {
      setTimeout(() => {
        oldWords.forEach((word) => {
          if (word.parentNode) {
            word.remove();
          }
        });
      }, 600);
    } else if (!animate && oldWords.length > 0) {
      // Se não anima, remove imediatamente
      oldWords.forEach((word) => word.remove());
    }
  }
}
