import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import WizardStep from '@/components/WizardStep.vue';

describe('wizard step', () => {
  it('shows the logo, its title, its description, its content and its actions', () => {
    const wrapper = mount(WizardStep, {
      props: { title: 'Rete', description: 'Scegli la rete Wi-Fi.', logo: true },
      slots: { default: '<p>content</p>', actions: '<button>Avanti</button>' },
    });

    expect(wrapper.get('[data-testid="wizard_step"]').attributes('aria-label')).toBe('Rete');
    expect(wrapper.get('header img').attributes('alt')).toBe('');
    expect(wrapper.get('h1').text()).toBe('Rete');
    expect(wrapper.text()).toContain('Scegli la rete Wi-Fi.');
    expect(wrapper.text()).toContain('content');
    expect(wrapper.get('footer button').text()).toBe('Avanti');
  });

  it('draws no footer when the step has no action', () => {
    const wrapper = mount(WizardStep, { props: { title: 'Rete' } });

    expect(wrapper.find('footer').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('p').exists()).toBe(false);
  });
});
