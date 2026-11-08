import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import WizardDisks from '@/components/steps/WizardDisks.vue';
import { setLocale } from '@/i18n';
import type { DiskPlan, WizardDisks as Offer } from '@/types/types';

const offer = (): Offer => ({
  enabled: true,
  disks: [
    { device: 'sdb', size: 2e12, model: 'Data Disk', identity: 'w/s/1', empty: true },
    { device: 'sdc', size: 1e12, model: null, identity: 'w/s/2', empty: false },
  ],
});

function disks(plans: Record<string, DiskPlan> = {}) {
  return mount(WizardDisks, {
    props: {
      offer: offer(),
      modelValue: plans,
      'onUpdate:modelValue': (value: Record<string, DiskPlan>) =>
        wrapper.setProps({ modelValue: value }),
    },
  });
}
let wrapper: ReturnType<typeof disks>;

beforeEach(() => setLocale('en'));

describe('WizardDisks', () => {
  it('offers to initialize only the empty disks, never encrypted', async () => {
    wrapper = disks();

    expect(wrapper.text()).toContain('/dev/sdb');
    expect(wrapper.text()).toContain('2000 GB');
    expect(wrapper.text()).toContain('Already holds data');
    expect(wrapper.find('[data-testid="wizard_disk_sdb_encrypted"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="wizard_disk_sdc_keep"]').exists()).toBe(false);

    await wrapper.get('[data-testid="wizard_disk_sdb_plain"]').trigger('click');
    expect(wrapper.props('modelValue')).toEqual({ sdb: 'plain' });
    expect(wrapper.text()).toContain('erases all of its content');
  });

  it('says that the encryption is set up later in the Disks app', () => {
    wrapper = disks({ sdb: 'plain' });

    expect(wrapper.get('[data-testid="wizard_disks_encryption_note"]').text()).toContain(
      'Disks app',
    );
  });

  it('says when no data disk is connected', () => {
    wrapper = mount(WizardDisks, {
      props: { offer: { enabled: true, disks: [] }, modelValue: {} },
    });

    expect(wrapper.text()).toContain('No empty data disk');
    expect(wrapper.find('[data-testid="wizard_disks_encryption_note"]').exists()).toBe(false);
  });
});
