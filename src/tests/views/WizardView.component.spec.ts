import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WizardView from '@/views/WizardView.vue';
import { request } from '@/api/client';
import { locale, setLocale } from '@/i18n';
import type { WizardDisks, WizardNetworks, WizardState } from '@/types/types';

vi.mock('@/api/client', () => ({ request: vi.fn() }));

const networks: WizardNetworks = {
  connection: { kind: 'lan', connected: true, ssid: null },
  wifi: [],
  canConnect: true,
  wifiNote: null,
};

function wizard(phase: WizardState['phase']): WizardState {
  return {
    phase,
    steps: [{ id: 'download_gateway', state: 'running', detail: '' }],
    simulated: true,
    version: '0.1.0',
  };
}

const noDisks: WizardDisks = { enabled: false, encryption: false, disks: [] };

/**
 * The wizard answering as it does: its state, the networks, its data disks and the installation it
 * starts.
 */
function answering(state: WizardState, disks: WizardDisks = noDisks) {
  vi.mocked(request).mockImplementation((path: string) => {
    const answers: Record<string, unknown> = {
      '/wizard': state,
      '/wizard/network/scan': networks,
      '/wizard/disks': disks,
      '/wizard/install': wizard('installing'),
    };
    return Promise.resolve(answers[path] as never);
  });
}

beforeEach(() => {
  networks.connection = { kind: 'lan', connected: true, ssid: null };
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  setLocale('it');
  vi.mocked(request).mockReset();
  answering(wizard('collecting'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function opened() {
  const wrapper = mount(WizardView);
  await flushPromises();
  return wrapper;
}

const next = (wrapper: VueWrapper) => wrapper.get('[data-testid="wizard_next"]');

async function walkThrough(wrapper: VueWrapper, token = ' ghp_token ') {
  await wrapper.get('[data-testid="wizard_start"]').trigger('click');
  await wrapper.get('[data-testid="wizard_username"]').setValue('admin');
  await wrapper.get('[data-testid="wizard_password"]').setValue('long enough');
  await wrapper.get('[data-testid="wizard_confirm"]').setValue('long enough');
  await next(wrapper).trigger('click');
  await wrapper.get('[data-testid="wizard_nas_name"]').setValue(' attic ');
  await wrapper.get('[data-testid="wizard_theme_dark"]').trigger('click');
  await next(wrapper).trigger('click');
  await flushPromises();
  await next(wrapper).trigger('click');
  await wrapper.get('[data-testid="wizard_token"]').setValue(token);
  await next(wrapper).trigger('click');
}

describe('setup wizard', () => {
  it('opens on the welcome, with the logo, the title and the call to configure', async () => {
    const wrapper = await opened();

    expect(wrapper.get('h1').text()).toBe('Configurazione iniziale');
    expect(wrapper.text()).toContain('Il NAS non è ancora configurato');
    expect(wrapper.get('[data-testid="wizard_start"]').text()).toBe('Configura');
    expect(wrapper.find('img').exists()).toBe(true);
    expect(wrapper.find('[data-testid="wizard_progress"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="wizard_back"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('goes on from the account only once both passwords match', async () => {
    const wrapper = await opened();
    await wrapper.get('[data-testid="wizard_start"]').trigger('click');

    expect(wrapper.get('h1').text()).toBe('Account amministratore');
    expect(wrapper.get('[data-testid="wizard_progress"]').attributes('aria-label')).toBe(
      'Passo 1 di 5',
    );
    expect(wrapper.find('img').exists()).toBe(false);
    await wrapper.get('[data-testid="wizard_username"]').setValue('admin');
    await wrapper.get('[data-testid="wizard_password"]').setValue('long enough');
    await wrapper.get('[data-testid="wizard_confirm"]').setValue('long enougj');
    expect(next(wrapper).attributes('disabled')).toBeDefined();

    await wrapper.get('[data-testid="wizard_confirm"]').setValue('long enough');
    expect(next(wrapper).attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('names the NAS "nas" until it is given a name a hostname can take', async () => {
    const wrapper = await opened();
    await wrapper.get('[data-testid="wizard_start"]').trigger('click');
    await wrapper.get('[data-testid="wizard_username"]').setValue('admin');
    await wrapper.get('[data-testid="wizard_password"]').setValue('long enough');
    await wrapper.get('[data-testid="wizard_confirm"]').setValue('long enough');
    await next(wrapper).trigger('click');

    const name = wrapper.get('[data-testid="wizard_nas_name"]');
    expect((name.element as HTMLInputElement).value).toBe('nas');
    expect(next(wrapper).attributes('disabled')).toBeUndefined();
    await name.setValue('the attic');
    expect(next(wrapper).attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('tra lettere, numeri e trattini');
    await name.setValue('attic-2');
    expect(next(wrapper).attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('switches the language and previews the theme as soon as they are chosen', async () => {
    const wrapper = await opened();
    await walkThrough(wrapper);
    await wrapper.get('[data-testid="wizard_back"]').trigger('click');
    await wrapper.get('[data-testid="wizard_back"]').trigger('click');
    await wrapper.get('[data-testid="wizard_back"]').trigger('click');

    await wrapper.get('[data-testid="wizard_language_en"]').trigger('click');

    expect(locale.value).toBe('en');
    expect(wrapper.get('h1').text()).toBe('Name, language and theme');
    expect(document.documentElement.dataset.theme).toBe('dark');
    wrapper.unmount();
  });

  it('goes on from the network only once the NAS is on one', async () => {
    networks.connection.connected = false;
    const wrapper = await opened();
    await wrapper.get('[data-testid="wizard_start"]').trigger('click');
    await wrapper.get('[data-testid="wizard_username"]').setValue('admin');
    await wrapper.get('[data-testid="wizard_password"]').setValue('long enough');
    await wrapper.get('[data-testid="wizard_confirm"]').setValue('long enough');
    await next(wrapper).trigger('click');
    await next(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.get('h1').text()).toBe('Rete Wi-Fi');
    expect(next(wrapper).attributes('disabled')).toBeDefined();
    networks.connection.connected = true;
    wrapper.unmount();
  });

  it('hands the choices to the wizard and follows the installation it starts', async () => {
    const wrapper = await opened();
    await walkThrough(wrapper);

    expect(wrapper.get('[data-testid="wizard_summary"]').text()).toContain('admin');
    expect(wrapper.get('[data-testid="wizard_summary"]').text()).toContain('attic');
    expect(wrapper.get('[data-testid="wizard_summary"]').text()).toContain('rete via cavo');
    expect(wrapper.get('[data-testid="wizard_summary"]').text()).toContain('Impostata');
    expect(
      wrapper
        .get('[data-testid="wizard_summary"]')
        .findAll('dt')
        .map((label) => label.text()),
    ).toEqual(['Nome utente', 'Password', 'Connessione', 'Lingua', 'Tema', 'Token']);
    expect(
      wrapper
        .get('[data-testid="wizard_summary"]')
        .findAll('dd')
        .map((value) => value.text()),
    ).toEqual(['admin', 'Impostata', 'rete via cavo', 'Italiano', 'Scuro', 'Impostato']);
    expect(wrapper.get('[data-testid="wizard_summary"]').text()).not.toContain('ghp_token');
    expect(wrapper.get('[data-testid="wizard_summary"]').text()).not.toContain('long enough');
    await wrapper.get('[data-testid="wizard_finish"]').trigger('click');
    await flushPromises();

    expect(request).toHaveBeenCalledWith('/wizard/install', {
      method: 'POST',
      body: JSON.stringify({
        username: 'admin',
        password: 'long enough',
        language: 'it',
        theme: 'dark',
        nasName: 'attic',
        token: 'ghp_token',
      }),
    });
    expect(wrapper.get('h1').text()).toBe('Installazione del NAS');
    expect(wrapper.find('[data-testid="wizard_install"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('goes from the password account straight to the appearance, without device settings', async () => {
    const wrapper = await opened();
    await wrapper.get('[data-testid="wizard_start"]').trigger('click');
    await wrapper.get('[data-testid="wizard_username"]').setValue('admin');
    await wrapper.get('[data-testid="wizard_password"]').setValue('long enough');
    await wrapper.get('[data-testid="wizard_confirm"]').setValue('long enough');
    await next(wrapper).trigger('click');

    expect(wrapper.get('h1').text()).toBe('Nome, lingua e tema');
    expect(wrapper.find('[data-testid="wizard_mtls"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="wizard_device_name"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('includes the connected Wi-Fi SSID in the final summary', async () => {
    networks.connection = { kind: 'wifi', connected: true, ssid: 'Home Office' };
    const wrapper = await opened();
    await walkThrough(wrapper);
    expect(wrapper.get('[data-testid="wizard_summary"]').text()).toContain('Wi-Fi · Home Office');
    expect(wrapper.get('[data-testid="wizard_summary"]').text()).not.toContain('rete via cavo');
    wrapper.unmount();
  });

  it('sends no token when the field stays empty', async () => {
    const wrapper = await opened();
    await walkThrough(wrapper, '');

    expect(wrapper.get('[data-testid="wizard_summary"]').text()).toContain('Nessuno');
    expect(wrapper.find('[data-testid="wizard_summary_mtls"]').exists()).toBe(false);
    await wrapper.get('[data-testid="wizard_finish"]').trigger('click');
    await flushPromises();

    const install = vi.mocked(request).mock.calls.find(([path]) => path === '/wizard/install');
    expect(JSON.parse(String(install?.[1]?.body))).not.toHaveProperty('token');
    wrapper.unmount();
  });

  it('stays on the summary and says why when the wizard refuses the configuration', async () => {
    const wrapper = await opened();
    await walkThrough(wrapper);
    vi.mocked(request).mockRejectedValue(new Error('down'));

    await wrapper.get('[data-testid="wizard_finish"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('Configurazione non avviata (down).');
    expect(wrapper.get('[data-testid="wizard_finish"]').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('returns to the account step when the system already uses its name', async () => {
    const wrapper = await opened();
    await walkThrough(wrapper);
    vi.mocked(request).mockRejectedValue(
      new Error('the account name belongs to a user of the system'),
    );

    await wrapper.get('[data-testid="wizard_finish"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="wizard_username"]').exists()).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain('belongs to a user of the system');
    wrapper.unmount();
  });

  it('opens on the installation when the wizard is already installing', async () => {
    answering(wizard('installing'));
    const wrapper = await opened();

    expect(wrapper.get('h1').text()).toBe('Installazione del NAS');
    expect(wrapper.find('[data-testid="wizard_start"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('says so when the wizard does not answer', async () => {
    vi.mocked(request).mockRejectedValue(new Error('the wizard is not answering'));
    const wrapper = await opened();

    expect(wrapper.get('[role="alert"]').text()).toContain('the wizard is not answering');
    expect(wrapper.find('[data-testid="wizard_start"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('offers the empty data disks where the wizard prepares them, and sends the chosen ones', async () => {
    answering(wizard('collecting'), {
      enabled: true,
      encryption: true,
      disks: [
        { device: 'sdb', size: 2e12, model: 'Data Disk', identity: 'w/s/1', empty: true },
        { device: 'sdc', size: 1e12, model: null, identity: 'w/s/2', empty: false },
      ],
    });
    const wrapper = await opened();
    await wrapper.get('[data-testid="wizard_start"]').trigger('click');
    await wrapper.get('[data-testid="wizard_username"]').setValue('admin');
    await wrapper.get('[data-testid="wizard_password"]').setValue('long enough');
    await wrapper.get('[data-testid="wizard_confirm"]').setValue('long enough');
    await next(wrapper).trigger('click');
    await next(wrapper).trigger('click');
    await flushPromises();
    await next(wrapper).trigger('click');

    const step = wrapper.get('[data-testid="wizard_disks"]');
    expect(step.text()).toContain('/dev/sdb');
    expect(step.text()).toContain('Data Disk');
    expect(step.text()).toContain('Contiene già dati');
    expect(wrapper.find('[data-testid="wizard_disk_sdc_keep"]').exists()).toBe(false);
    await wrapper.get('[data-testid="wizard_disk_sdb_encrypted"]').trigger('click');
    expect(step.text()).toContain('cancella tutto');
    await next(wrapper).trigger('click');
    await next(wrapper).trigger('click');
    expect(wrapper.get('[data-testid="wizard_summary"]').text()).toContain('sdb (cifrato)');
    await wrapper.get('[data-testid="wizard_finish"]').trigger('click');
    await flushPromises();

    const sent = vi
      .mocked(request)
      .mock.calls.find(([path]) => path === '/wizard/install')?.[1] as RequestInit;
    expect(JSON.parse(sent.body as string).disks).toEqual([
      { device: 'sdb', identity: 'w/s/1', encrypt: true },
    ]);
  });
});
