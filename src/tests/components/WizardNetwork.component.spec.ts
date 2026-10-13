import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import WizardNetwork from '@/components/WizardNetwork.vue';
import { request } from '@/api/client';
import { setLocale } from '@/i18n';

vi.mock('@/api/client', () => ({ request: vi.fn() }));

const reachable = {
  connection: { kind: 'lan', connected: true, ssid: null },
  wifi: [
    { ssid: 'Home', signal: 80, security: 'WPA2', known: false },
    { ssid: 'Guest', signal: 40, security: 'open', known: false },
  ],
  canConnect: true,
  wifiNote: null,
};

beforeEach(() => {
  setLocale('it');
  vi.mocked(request).mockReset().mockResolvedValue(reachable);
});

it('looks for networks on opening and says where the NAS is connected', async () => {
  const wrapper = mount(WizardNetwork);
  await flushPromises();

  expect(request).toHaveBeenCalledWith(
    '/wizard/network/scan',
    expect.objectContaining({ method: 'POST', body: '{}' }),
  );
  expect(wrapper.get('[data-testid="wizard_network_current"]').text()).toBe(
    'Collegato a rete via cavo',
  );
  expect(wrapper.findAll('li').map((row) => row.text())).toEqual(['Home80%', 'Guest40%']);
});

it('shows a spinner in place of the list while it looks for networks', async () => {
  let answer!: (value: unknown) => void;
  vi.mocked(request).mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );

  const wrapper = mount(WizardNetwork);
  await flushPromises();

  expect(wrapper.get('[data-testid="wizard_network_scanning"]').text()).toBe(
    'Ricerca delle reti in corso',
  );
  expect(wrapper.find('li').exists()).toBe(false);
  expect(wrapper.get('[data-testid="wizard_network_scan"]').attributes('disabled')).toBeDefined();

  answer(reachable);
  await flushPromises();

  expect(wrapper.find('[data-testid="wizard_network_scanning"]').exists()).toBe(false);
  expect(wrapper.findAll('li')).toHaveLength(2);
});

it('asks for the password of a protected network and joins it', async () => {
  const wrapper = mount(WizardNetwork);
  await flushPromises();

  await wrapper.get('[data-testid="wizard_network_Home"]').trigger('click');
  await wrapper.get('[data-testid="wizard_network_password"]').setValue('wifi secret');
  await wrapper.get('form').trigger('submit');
  await flushPromises();

  expect(request).toHaveBeenLastCalledWith(
    '/wizard/network/wifi',
    expect.objectContaining({ body: JSON.stringify({ ssid: 'Home', password: 'wifi secret' }) }),
  );
  expect(wrapper.find('form').exists()).toBe(false);
});

it('joins an open network without asking for a password', async () => {
  const wrapper = mount(WizardNetwork);
  await flushPromises();

  await wrapper.get('[data-testid="wizard_network_Guest"]').trigger('click');
  expect(wrapper.find('[data-testid="wizard_network_password"]').exists()).toBe(false);
  await wrapper.get('form').trigger('submit');
  await flushPromises();

  expect(request).toHaveBeenLastCalledWith(
    '/wizard/network/wifi',
    expect.objectContaining({ body: JSON.stringify({ ssid: 'Guest' }) }),
  );
});

it('says why nothing is listed, and what went wrong', async () => {
  vi.mocked(request).mockResolvedValueOnce({
    ...reachable,
    wifi: [],
    canConnect: false,
    wifiNote: 'no wireless interface',
  });
  const wrapper = mount(WizardNetwork);
  await flushPromises();

  expect(wrapper.text()).toContain('no wireless interface');
  expect(wrapper.text()).toContain('Gestione della rete non disponibile');

  vi.mocked(request).mockRejectedValueOnce(new Error('the NAS is already configured'));
  await wrapper.get('[data-testid="wizard_network_scan"]').trigger('click');
  await flushPromises();

  expect(wrapper.get('[role="alert"]').text()).toBe('the NAS is already configured');
});

it('tells the wizard whether the NAS is on a network', async () => {
  const wrapper = mount(WizardNetwork);
  await flushPromises();
  expect(wrapper.emitted('update:connected')).toEqual([[true]]);

  vi.mocked(request).mockResolvedValue({
    ...reachable,
    connection: { kind: 'lan', connected: false, ssid: null },
  });
  await wrapper.get('[data-testid="wizard_network_scan"]').trigger('click');
  await flushPromises();
  expect(wrapper.emitted('update:connected')?.at(-1)).toEqual([false]);
});
