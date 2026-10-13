import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import WizardToken from '@/components/WizardToken.vue';
import { request } from '@/api/client';
import { setLocale } from '@/i18n';

vi.mock('@/api/client', () => ({ request: vi.fn() }));

beforeEach(() => {
  setLocale('it');
  vi.mocked(request).mockReset();
});

it('hides the token as it is typed and hands it to the wizard', async () => {
  const wrapper = mount(WizardToken, { props: { modelValue: '' } });
  const field = wrapper.get('[data-testid="wizard_token"]');

  expect(field.attributes('type')).toBe('password');
  await field.setValue('ghp_token');

  expect(wrapper.emitted('update:modelValue')).toEqual([['ghp_token']]);
});

it('says a token with a space cannot be one, as soon as the field is selected', async () => {
  const wrapper = mount(WizardToken, { props: { modelValue: 'two words' } });

  expect(wrapper.find('[aria-live="polite"]').exists()).toBe(false);
  await wrapper.get('[data-testid="wizard_token"]').trigger('focus');

  expect(wrapper.get('[aria-live="polite"]').text()).toBe('Il token non può contenere spazi.');
  expect(wrapper.get('[data-testid="wizard_token_check"]').attributes('disabled')).toBeDefined();
});

it('says that without a token only public releases can be read', () => {
  const wrapper = mount(WizardToken, { props: { modelValue: '' } });

  expect(wrapper.get('[data-testid="wizard_token_note"]').text()).toContain(
    'solo release pubbliche',
  );
});

it('checks the token on every repository and says how each one answered', async () => {
  vi.mocked(request).mockResolvedValue([
    { repository: 'ValerioGc/nas-gateway', access: 'ok' },
    { repository: 'ValerioGc/nas-launcher', access: 'forbidden' },
  ]);
  const wrapper = mount(WizardToken, { props: { modelValue: ' ghp_token ' } });

  await wrapper.get('[data-testid="wizard_token_check"]').trigger('click');
  await flushPromises();

  expect(request).toHaveBeenCalledWith(
    '/wizard/token',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'ghp_token' }),
    }),
  );
  const answers = wrapper.get('[data-testid="wizard_token_answers"]').text();
  expect(answers).toContain('ValerioGc/nas-gateway');
  expect(answers).toContain('Accessibile');
  expect(answers).toContain('Permessi mancanti');
});

it('checks the releases without a token when the field is empty, and says why it could not', async () => {
  vi.mocked(request).mockRejectedValue(new Error('the wizard is not answering'));
  const wrapper = mount(WizardToken, { props: { modelValue: '' } });

  await wrapper.get('[data-testid="wizard_token_check"]').trigger('click');
  await flushPromises();

  expect(request).toHaveBeenCalledWith('/wizard/token', expect.objectContaining({ body: '{}' }));
  expect(wrapper.get('[role="alert"]').text()).toBe('the wizard is not answering');
});
