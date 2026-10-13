import { mount } from '@vue/test-utils';
import { beforeEach, expect, it } from 'vitest';
import WizardAppearance from '@/components/WizardAppearance.vue';
import { setLocale } from '@/i18n';

beforeEach(() => setLocale('it'));

it('offers both languages and the three themes, with the current ones pressed', async () => {
  const wrapper = mount(WizardAppearance, {
    props: { name: 'nas', language: 'it', theme: 'system' },
  });

  expect(wrapper.get('[data-testid="wizard_language_it"]').attributes('aria-pressed')).toBe('true');
  expect(wrapper.get('[data-testid="wizard_theme_system"]').attributes('aria-pressed')).toBe(
    'true',
  );
  expect(wrapper.findAll('[data-testid^="wizard_theme_"]').map((b) => b.text())).toEqual([
    'Sistema',
    'Chiaro',
    'Scuro',
  ]);

  await wrapper.get('[data-testid="wizard_language_en"]').trigger('click');
  await wrapper.get('[data-testid="wizard_theme_dark"]').trigger('click');

  expect(wrapper.emitted('update:language')).toEqual([['en']]);
  expect(wrapper.emitted('update:theme')).toEqual([['dark']]);
});

it('takes the name of the NAS and says when a hostname could not take it', async () => {
  const wrapper = mount(WizardAppearance, {
    props: { name: 'nas', language: 'it', theme: 'system' },
  });
  const field = wrapper.get('[data-testid="wizard_nas_name"]');

  expect((field.element as HTMLInputElement).value).toBe('nas');
  expect(wrapper.text()).not.toContain('tra lettere, numeri e trattini');
  await field.setValue('the attic');
  await wrapper.setProps({ name: 'the attic' });

  expect(wrapper.emitted('update:name')).toEqual([['the attic']]);
  expect(field.attributes('aria-invalid')).toBe('true');
  expect(wrapper.text()).toContain('tra lettere, numeri e trattini');
});
