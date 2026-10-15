import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import WizardDisks from '@/components/WizardDisks.vue';
import { setLocale } from '@/i18n';
import type { DiskPlan, WizardDisks as Offer } from '@/types/types';

const offer = (encryption: boolean): Offer => ({
  enabled: true,
  encryption,
  disks: [
    { device: 'sdb', size: 2e12, model: 'Data Disk', identity: 'w/s/1', empty: true },
    { device: 'sdc', size: 1e12, model: null, identity: 'w/s/2', empty: false },
  ],
});

function disks(encryption: boolean, plans: Record<string, DiskPlan> = {}) {
  return mount(WizardDisks, {
    props: {
      offer: offer(encryption),
      modelValue: plans,
      'onUpdate:modelValue': (value: Record<string, DiskPlan>) =>
        wrapper.setProps({ modelValue: value }),
    },
  });
}
let wrapper: ReturnType<typeof disks>;

beforeEach(() => setLocale('en'));

describe('WizardDisks', () => {
  it('offers to initialize only the empty disks, encrypted where the wizard can', async () => {
    wrapper = disks(false);

    expect(wrapper.text()).toContain('/dev/sdb');
    expect(wrapper.text()).toContain('2000 GB');
    expect(wrapper.text()).toContain('Already holds data');
    expect(wrapper.find('[data-testid="wizard_disk_sdb_encrypted"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="wizard_disk_sdc_keep"]').exists()).toBe(false);

    await wrapper.get('[data-testid="wizard_disk_sdb_plain"]').trigger('click');
    expect(wrapper.props('modelValue')).toEqual({ sdb: 'plain' });
    expect(wrapper.text()).toContain('erases all of its content');
  });

  it('explains how an encrypted disk opens', () => {
    wrapper = disks(true, { sdb: 'encrypted' });

    expect(
      wrapper.get('[data-testid="wizard_disk_sdb_encrypted"]').attributes('aria-pressed'),
    ).toBe('true');
    expect(wrapper.text()).toContain('unlocks by itself at startup');
  });

  it('says when no data disk is connected', () => {
    wrapper = mount(WizardDisks, {
      props: { offer: { enabled: true, encryption: false, disks: [] }, modelValue: {} },
    });

    expect(wrapper.text()).toContain('No empty data disk');
  });
});
