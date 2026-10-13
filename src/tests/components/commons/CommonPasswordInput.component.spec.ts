import { mount } from '@vue/test-utils';
import { beforeEach, expect, it } from 'vitest';
import CommonPasswordInput from '@/components/commons/CommonPasswordInput.vue';
import { setLocale } from '@/i18n';

beforeEach(() => setLocale('it'));

it('hides what is typed until the eye is pressed, and hides it again', async () => {
  const wrapper = mount(CommonPasswordInput, { props: { id: 'field', modelValue: 'secret' } });
  const toggle = wrapper.get('button');

  expect(wrapper.get('input').attributes('type')).toBe('password');
  expect(toggle.attributes('aria-label')).toBe('Mostra password');

  await toggle.trigger('click');
  expect(wrapper.get('input').attributes('type')).toBe('text');
  expect(toggle.attributes('aria-pressed')).toBe('true');
  expect(toggle.attributes('aria-label')).toBe('Nascondi password');

  await toggle.trigger('click');
  expect(wrapper.get('input').attributes('type')).toBe('password');
});

it('gives its id and attributes to the input and hands back what is typed', async () => {
  const wrapper = mount(CommonPasswordInput, {
    props: { id: 'wizard_password', modelValue: '', newPassword: true },
    attrs: { 'data-testid': 'field' },
  });

  const input = wrapper.get('[data-testid="field"]');
  expect(input.element.tagName).toBe('INPUT');
  expect(input.attributes('id')).toBe('wizard_password');
  expect(input.attributes('autocomplete')).toBe('new-password');
  expect(wrapper.find('span').attributes('id')).toBeUndefined();
  await input.setValue('typed');

  expect(wrapper.emitted('update:modelValue')).toEqual([['typed']]);
});

it('asks the browser not to fill in a password that is not being chosen', () => {
  const wrapper = mount(CommonPasswordInput, { props: { id: 'token', modelValue: '' } });

  expect(wrapper.get('input').attributes('autocomplete')).toBe('off');
});
