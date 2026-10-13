import { mount } from '@vue/test-utils';
import { beforeEach, expect, it } from 'vitest';
import WizardProgress from '@/components/WizardProgress.vue';
import { setLocale } from '@/i18n';

beforeEach(() => setLocale('it'));

it('numbers every step, marks the ones behind and the one on screen', () => {
  const wrapper = mount(WizardProgress, { props: { current: 3, total: 5 } });
  const steps = wrapper.findAll('li');

  expect(wrapper.get('ol').attributes('aria-label')).toBe('Passo 3 di 5');
  expect(steps.map((step) => step.text())).toEqual(['1', '2', '3', '4', '5']);
  expect(steps.map((step) => step.classes('wizard_progress_done'))).toEqual([
    true,
    true,
    false,
    false,
    false,
  ]);
  expect(steps.map((step) => step.attributes('aria-current'))).toEqual([
    undefined,
    undefined,
    'step',
    undefined,
    undefined,
  ]);
});
