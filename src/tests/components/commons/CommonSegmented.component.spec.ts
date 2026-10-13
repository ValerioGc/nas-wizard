import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import CommonSegmented from '@/components/commons/CommonSegmented.vue';
import { setLocale } from '@/i18n';

const options = [
  { value: 'light', label: 'light', icon: '/light.svg' },
  { value: 'dark', label: 'dark' },
];

beforeEach(() => setLocale('en'));

describe('CommonSegmented', () => {
  it('shows every option translated, as a labelled group, with the chosen one pressed', () => {
    const wrapper = mount(CommonSegmented, {
      props: { options, label: 'Theme', modelValue: 'dark', testid: 'choice' },
    });

    expect(wrapper.element.tagName).toBe('FIELDSET');
    expect(wrapper.attributes('aria-label')).toBe('Theme');
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['Light', 'Dark']);
    expect(wrapper.get('[data-testid="choice_dark"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[data-testid="choice_light"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.findAll('[data-testid="common_icon"]')).toHaveLength(1);
  });

  it('chooses the option that is pressed', async () => {
    const wrapper = mount(CommonSegmented, {
      props: { options, label: 'Theme', modelValue: 'dark', testid: 'choice' },
    });

    await wrapper.get('[data-testid="choice_light"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['light']);
  });
});
