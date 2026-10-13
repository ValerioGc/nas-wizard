import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WizardInstall from '@/components/WizardInstall.vue';
import { request } from '@/api/client';
import { setLocale } from '@/i18n';
import type { InstallStep, WizardState } from '@/types/types';

vi.mock('@/api/client', () => ({ request: vi.fn() }));

function state(phase: WizardState['phase'], steps: InstallStep[], simulated = false): WizardState {
  return { phase, steps, simulated, version: '0.1.0' };
}

const gateway: InstallStep = { id: 'download_gateway', state: 'done', detail: 'version 0.1.7' };
const launcher: InstallStep = { id: 'install_ui', state: 'running', detail: '' };

beforeEach(() => {
  vi.useFakeTimers();
  setLocale('it');
  vi.mocked(request).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('installation', () => {
  it('lists the steps and follows them until they are done', async () => {
    const wrapper = mount(WizardInstall, {
      props: { initial: state('installing', [gateway, launcher]) },
    });

    expect(wrapper.get('[data-testid="wizard_install_download_gateway"]').text()).toContain(
      'Scaricamento del gateway',
    );
    expect(wrapper.get('[data-testid="wizard_install_download_gateway"]').text()).toContain(
      'version 0.1.7',
    );
    expect(wrapper.get('[data-testid="wizard_install_install_ui"]').attributes('data-state')).toBe(
      'running',
    );

    vi.mocked(request).mockResolvedValue(
      state('done', [gateway, { ...launcher, state: 'done' }], true),
    );
    await vi.advanceTimersByTimeAsync(2000);

    expect(request).toHaveBeenCalledWith('/wizard');
    expect(wrapper.get('[data-testid="wizard_install_install_ui"]').attributes('data-state')).toBe(
      'done',
    );
    expect(wrapper.get('[data-testid="wizard_simulated"]').text()).toContain(
      'nessuna installazione eseguita',
    );
    wrapper.unmount();
  });

  it('shows why a step failed and starts again from it', async () => {
    const shown: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      shown.push(this);
    };
    const failed = { ...launcher, state: 'failed' as const, detail: 'exit 1\nno space left' };
    const wrapper = mount(WizardInstall, {
      props: { initial: state('failed', [gateway, failed]) },
    });
    await flushPromises();
    expect(shown.at(-1)?.getAttribute('data-testid')).toBe('wizard_retry');
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');

    expect(wrapper.get('[data-testid="wizard_install_install_ui"]').text()).toContain(
      'no space left',
    );
    vi.mocked(request).mockResolvedValue(state('installing', [gateway, launcher]));
    await wrapper.get('[data-testid="wizard_retry"]').trigger('click');
    await flushPromises();

    expect(request).toHaveBeenCalledWith('/wizard/retry', { method: 'POST' });
    expect(wrapper.find('[data-testid="wizard_retry"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('opens login on the forwarded origin once the wizard hands the port over', async () => {
    // Built one at a time, as they are asked for: a rejection made in advance would go unhandled.
    const answers = [
      () => Promise.reject(new Error('the port is changing hands')),
      // The wizard answers its own page there, never "ok".
      () => Promise.resolve(new Response('<!doctype html>', { status: 200 })),
      () => Promise.resolve(new Response('ok', { status: 200 })),
      () => Promise.resolve(new Response('<!doctype html><title>Login</title>', { status: 200 })),
    ];
    const fetch = vi.fn(() => answers.shift()?.() ?? Promise.reject(new Error('done')));
    const assign = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('location', { assign, origin: 'http://localhost:8080' });
    const handover: InstallStep = { id: 'handover', state: 'running', detail: '' };
    const wrapper = mount(WizardInstall, {
      props: { initial: state('done', [gateway, handover]) },
    });

    expect(wrapper.find('[data-testid="wizard_handover"]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(6000);

    expect(fetch).toHaveBeenCalledWith('/health', expect.objectContaining({ cache: 'no-store' }));
    expect(fetch).toHaveBeenCalledWith(
      '/login',
      expect.objectContaining({ cache: 'reload', redirect: 'error' }),
    );
    // Login avoids an old cached redirect on `/` and keeps the forwarded origin.
    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/login');
    expect(new URL(assign.mock.calls[0]?.[0], window.location.origin).href).toBe(
      'http://localhost:8080/login',
    );
    expect(request).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('keeps waiting when login redirects or fails instead of losing the forwarded origin', async () => {
    const assign = vi.fn();
    const login = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('login redirected'))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('<html>login</html>', { status: 200 }));
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) => (path === '/health' ? Promise.resolve(new Response('ok')) : login())),
    );
    vi.stubGlobal('location', { assign, origin: 'http://localhost:8080' });
    const wrapper = mount(WizardInstall, { props: { initial: state('done', []) } });

    await vi.advanceTimersByTimeAsync(4000);
    expect(assign).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="wizard_handover"]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(assign).toHaveBeenCalledExactlyOnceWith('/login');
    wrapper.unmount();
  });

  it('offers the certificates once only the handover is left, then waits for the NAS', async () => {
    vi.mocked(request).mockImplementation((path: string) =>
      Promise.resolve(
        (path === '/wizard/certificate'
          ? { caPem: null }
          : state('done', [gateway], true)) as never,
      ),
    );
    const handover: InstallStep = { id: 'handover', state: 'pending', detail: '' };
    const wrapper = mount(WizardInstall, {
      props: { initial: state('ready', [gateway, handover]) },
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="wizard_certificate"]').exists()).toBe(true);
    await wrapper.get('[data-testid="wizard_go_to_login"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="wizard_certificate"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="wizard_simulated"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
