import { describe, expect, it } from 'vitest';
import {
  onboardingDecision,
  onboardingSteps,
  resumeStep,
  skipAllImpact,
  stepAfter,
  stepBefore,
} from './onboarding-plan';

describe('onboardingDecision', () => {
  it('mostra na primeira abertura de quem ainda não tem conta', () => {
    expect(onboardingDecision('', false)).toBe('show');
  });

  it('não mostra para quem já usava o app com a conta conectada', () => {
    expect(onboardingDecision('', true)).toBe('existing-user');
  });

  it('continua mostrando se a configuração foi interrompida, mesmo com a conta já conectada', () => {
    expect(onboardingDecision('pending', true)).toBe('show');
  });

  it('nunca mais mostra depois de concluída ou pulada', () => {
    expect(onboardingDecision('done', false)).toBe('hide');
    expect(onboardingDecision('done', true)).toBe('hide');
  });
});

describe('etapas', () => {
  it('a sincronização só aparece com a conta conectada', () => {
    expect(onboardingSteps(false)).not.toContain('sincronizacao');
    expect(onboardingSteps(true)).toEqual(['conta', 'sincronizacao', 'avisos', 'app-externo', 'inicializacao']);
  });

  it('retoma depois da conta quando ela já está conectada', () => {
    expect(resumeStep(false)).toBe('conta');
    expect(resumeStep(true)).toBe('sincronizacao');
  });

  it('avança e volta dentro dos limites', () => {
    const steps = onboardingSteps(false);
    expect(stepAfter(steps, 'conta')).toBe('avisos');
    expect(stepAfter(steps, 'inicializacao')).toBeNull();
    expect(stepBefore(steps, 'conta')).toBeNull();
    expect(stepBefore(steps, 'app-externo')).toBe('avisos');
  });

  it('ao conectar a conta, a próxima etapa passa a ser a sincronização', () => {
    expect(stepAfter(onboardingSteps(true), 'conta')).toBe('sincronizacao');
  });
});

describe('skipAllImpact', () => {
  it('lista o que deixa de funcionar quando a conta não foi conectada', () => {
    expect(skipAllImpact(false).features.length).toBeGreaterThan(0);
    expect(skipAllImpact(true).features).toEqual([]);
  });
});
