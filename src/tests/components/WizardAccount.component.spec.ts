import { mount } from '@vue/test-utils';
import { beforeEach, expect, it } from 'vitest';
import WizardAccount from '@/components/WizardAccount.vue';
import { setLocale } from '@/i18n';

beforeEach(() => setLocale('it'));

function account(username = '', password = '', confirm = '') {
  return mount(WizardAccount, { props: { username, password, confirm } });
}

it('says what is wrong with a field as soon as it is selected', async () => {
  const wrapper = account('ad min', 'short', 'other');

  expect(wrapper.find('[aria-live="polite"]').exists()).toBe(false);
  for (const field of ['username', 'password', 'confirm']) {
    await wrapper.get(`[data-testid="wizard_${field}"]`).trigger('focus');
  }

  expect(wrapper.findAll('[aria-live="polite"]').map((error) => error.text())).toEqual([
    'Il nome inizia con una lettera o un trattino basso e contiene lettere, numeri, punti, trattini o trattini bassi.',
    'Sono richiesti da 8 a 128 caratteri.',
    'Le due password non coincidono.',
  ]);
});

it('hands every field back to the wizard as it is typed', async () => {
  const wrapper = account();

  await wrapper.get('[data-testid="wizard_username"]').setValue('admin');
  await wrapper.get('[data-testid="wizard_password"]').setValue('long enough');

  expect(wrapper.emitted('update:username')).toEqual([['admin']]);
  expect(wrapper.emitted('update:password')).toEqual([['long enough']]);
  expect(wrapper.get('[data-testid="wizard_password"]').attributes('type')).toBe('password');
});

it('names every field with the label that points at it', () => {
  const wrapper = account();

  for (const field of ['username', 'password', 'confirm']) {
    const label = wrapper.get(`label[for="wizard_${field}"]`);
    expect(wrapper.get(`input#wizard_${field}`).element).toBeTruthy();
    expect(label.text()).not.toBe('');
  }
});
