<script setup lang="ts">

import { nextTick, onMounted, ref } from 'vue';
import { t } from '@/i18n';
import { request } from '@/api/client';
import { failureMessage } from '@/utils/failureMessage';
import type { CertificateOffer, WizardState } from '@/types/types';

import CommonSpinner from '@/components/commons/CommonSpinner.vue';

const emit = defineEmits<{ finished: [state: WizardState] }>();

const root = ref<HTMLElement | null>(null);
const offer = ref<CertificateOffer | null>(null);
const busy = ref(false);
const error = ref('');

/** Hands `bytes` to the browser as a file to save. The page is plain HTTP: no Clipboard, no more. */
function save(bytes: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function saveAuthority() {
  if (offer.value?.caPem) {
    save(offer.value.caPem, 'nas-os-ca.crt', 'application/x-x509-ca-cert');
  }
}

async function finish() {
  busy.value = true;
  error.value = '';
  try {
    emit('finished', await request<WizardState>('/wizard/finish', { method: 'POST' }));
  } catch (reason) {
    error.value = failureMessage(reason);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    offer.value = await request<CertificateOffer>('/wizard/certificate');
  } catch (reason) {
    error.value = failureMessage(reason);
  }
  // It comes below the list of the installation: brought into view, button included.
  await nextTick();
  root.value?.scrollIntoView?.({ block: 'end' });
});

</script>

<template>
  <section
    ref="root"
    class="wizard_certificate"
    :aria-label="t('certificateTitle')"
    data-testid="wizard_certificate"
  >
    <CommonSpinner v-if="!offer && !error" :label="t('certificateLoading')" centered />

    <template v-if="offer">
      <p v-if="!offer.caPem" class="muted" data-testid="wizard_certificate_simulated">
        {{ t('certificateSimulated') }}
      </p>

      <div class="wizard_certificate_part">
        <h3>{{ t('authorityTitle') }}</h3>
        <p class="muted">{{ t('authorityNote') }}</p>
        <button
          v-if="offer.caPem"
          type="button"
          data-testid="wizard_authority_download"
          @click="saveAuthority"
        >
          {{ t('authorityDownload') }}
        </button>
      </div>
    </template>

    <p v-if="error" role="alert" class="app_error">{{ error }}</p>

    <button
      v-if="offer"
      type="button"
      class="primary"
      :disabled="busy"
      data-testid="wizard_go_to_login"
      @click="finish"
    >
      <CommonSpinner v-if="busy" size="small" compact />
      {{ t('goToLogin') }}
    </button>
  </section>
</template>

<style scoped lang="scss">

.wizard_certificate {
  @extend %stack;
  gap: $space_4;
}

.wizard_certificate_part {
  @extend %panel_sunken;
  @extend %stack;
  gap: $space_2;
  padding: $space_4;

  h3,
  p {
    margin: 0;
  }

  button {
    align-self: start;
  }
}

</style>
