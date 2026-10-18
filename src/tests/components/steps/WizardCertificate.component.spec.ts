import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WizardCertificate from '@/components/steps/WizardCertificate.vue';
import { request } from '@/api/client';
import { setLocale } from '@/i18n';
import type { CertificateOffer, WizardState } from '@/types/types';

vi.mock('@/api/client', () => ({ request: vi.fn() }));

const done: WizardState = { phase: 'done', steps: [], simulated: false, version: '0.1.0' };
const authority: CertificateOffer = {
  caPem: '-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n',
};

function answering(offer: CertificateOffer) {
  vi.mocked(request).mockImplementation((path: string) =>
    Promise.resolve((path === '/wizard/certificate' ? offer : done) as never),
  );
}

let saved: { name: string; blob: Blob }[] = [];

beforeEach(() => {
  setLocale('it');
  saved = [];
  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => {
      saved.push({ name: '', blob });
      return 'blob:file';
    },
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.at(-1)!.name = this.download;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HTTPS authority at the end of the installation', () => {
  it('hands over to password sign-in without a device certificate', async () => {
    const shown: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      shown.push(this);
    };
    answering(authority);
    const wrapper = mount(WizardCertificate);
    await flushPromises();
    expect(shown).toEqual([wrapper.element]);
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');

    const go = wrapper.get('[data-testid="wizard_go_to_login"]');
    expect(go.attributes('disabled')).toBeUndefined();
    expect(wrapper.find('[data-testid="wizard_device"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="wizard_certificate_confirm"]').exists()).toBe(false);
    await go.trigger('click');
    await flushPromises();

    expect(request).toHaveBeenCalledWith('/wizard/finish', { method: 'POST' });
    expect(wrapper.emitted('finished')?.[0]).toEqual([done]);
  });

  it('saves only the HTTPS authority under its name', async () => {
    answering(authority);
    const wrapper = mount(WizardCertificate);
    await flushPromises();

    await wrapper.get('[data-testid="wizard_authority_download"]').trigger('click');

    expect(saved.map((file) => file.name)).toEqual(['nas-os-ca.crt']);
    expect(await saved[0]!.blob.text()).toContain('BEGIN CERTIFICATE');
    expect(saved[0]!.blob.type).toBe('application/x-x509-ca-cert');
    expect(wrapper.find('[data-testid="wizard_device_download"]').exists()).toBe(false);
  });

  it('allows sign-in and offers no authority in a simulation', async () => {
    answering({ caPem: null });
    const wrapper = mount(WizardCertificate);
    await flushPromises();

    expect(wrapper.find('[data-testid="wizard_device"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="wizard_authority_download"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="wizard_certificate_simulated"]').exists()).toBe(true);
    expect(
      wrapper.get('[data-testid="wizard_go_to_login"]').attributes('disabled'),
    ).toBeUndefined();
  });

  it('says why when the certificates or the end are refused', async () => {
    vi.mocked(request).mockRejectedValue(new Error('there is nothing to download yet'));
    const wrapper = mount(WizardCertificate);
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('nothing to download');
    expect(wrapper.find('[data-testid="wizard_go_to_login"]').exists()).toBe(false);

    answering(authority);
    const second = mount(WizardCertificate);
    await flushPromises();
    vi.mocked(request).mockRejectedValue(new Error('the installation is not at its end yet'));
    await second.get('[data-testid="wizard_go_to_login"]').trigger('click');
    await flushPromises();
    expect(second.get('[role="alert"]').text()).toContain('not at its end');
    expect(second.emitted('finished')).toBeUndefined();
  });
});
