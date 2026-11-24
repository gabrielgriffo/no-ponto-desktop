import { OnboardingState } from '../settings-modal/settings.model';

export type OnboardingStep = 'conta' | 'sincronizacao' | 'avisos' | 'app-externo' | 'inicializacao';
export type OnboardingDecision = 'show' | 'hide' | 'existing-user';

export interface StepText {
  label: string;
  title: string;
  description: string;
}

export const STEP_TEXT: Record<OnboardingStep, StepText> = {
  'conta': {
    label: 'Conta',
    title: 'Conecte sua conta do PontoMais',
    description: 'O No Ponto importa os registros do dia direto do PontoMais para calcular a sua jornada.',
  },
  'sincronizacao': {
    label: 'Sincronização',
    title: 'Mantenha os registros em dia',
    description: 'Escolha se o No Ponto deve buscar as novas batidas sozinho, sem você precisar clicar em Importar.',
  },
  'avisos': {
    label: 'Alarme',
    title: 'Saiba quando o expediente acabar',
    description: 'Ligue o alarme para ouvir um aviso no fim da jornada e escolha o som que preferir.',
  },
  'app-externo': {
    label: 'Aplicativo externo',
    title: 'Abra um aplicativo junto com o expediente',
    description: 'O No Ponto pode abrir um aplicativo de sua escolha no início do expediente e na volta do intervalo.',
  },
  'inicializacao': {
    label: 'Inicialização',
    title: 'Comece junto com o computador',
    description: 'Defina se o No Ponto deve abrir com o sistema e ficar na bandeja acompanhando o expediente.',
  },
};

export interface SkipImpact {
  title: string;
  intro: string;
  features: string[];
}

const ACCOUNT_FEATURES = [
  'Importar os registros de ponto do dia',
  'Sincronização automática das batidas',
  'Abrir o aplicativo externo no início do expediente',
];

export const SKIP_ACCOUNT: SkipImpact = {
  title: 'Pular a conta do PontoMais?',
  intro:
    'Sem a conta, estas funcionalidades não vão funcionar até você conectá-la em Configurações › Conta. Os horários ainda podem ser digitados à mão.',
  features: ACCOUNT_FEATURES,
};

export function skipAllImpact(loggedIn: boolean): SkipImpact {
  if (loggedIn) {
    return {
      title: 'Pular a configuração inicial?',
      intro: 'As opções que você ainda não ajustou ficam com os valores padrão. Você pode mudá-las depois em Configurações.',
      features: [],
    };
  }
  return {
    title: 'Pular a configuração inicial?',
    intro:
      'As opções que você ainda não ajustou ficam com os valores padrão, e estas funcionalidades não vão funcionar até você conectar a conta em Configurações › Conta:',
    features: ACCOUNT_FEATURES,
  };
}

export function onboardingDecision(state: OnboardingState, loggedIn: boolean): OnboardingDecision {
  if (state === 'done') return 'hide';
  if (state === 'pending') return 'show';
  return loggedIn ? 'existing-user' : 'show';
}

export function onboardingSteps(loggedIn: boolean): OnboardingStep[] {
  return loggedIn
    ? ['conta', 'sincronizacao', 'avisos', 'app-externo', 'inicializacao']
    : ['conta', 'avisos', 'app-externo', 'inicializacao'];
}

export function resumeStep(loggedIn: boolean): OnboardingStep {
  return onboardingSteps(loggedIn)[loggedIn ? 1 : 0];
}

export function stepAfter(steps: OnboardingStep[], current: OnboardingStep): OnboardingStep | null {
  const index = steps.indexOf(current);
  return index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
}

export function stepBefore(steps: OnboardingStep[], current: OnboardingStep): OnboardingStep | null {
  const index = steps.indexOf(current);
  return index > 0 ? steps[index - 1] : null;
}
