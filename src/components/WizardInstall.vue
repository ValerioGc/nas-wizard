<script setup lang="ts">

import { computed, nextTick, ref, watch } from 'vue';
import { t } from '@/i18n';
import { request } from '@/api/client';
import { usePolling } from '@/composables/usePolling';
import { failureMessage } from '@/utils/failureMessage';
import type { InstallStep, StepId, WizardState } from '@/types/types';

import CommonIcon from '@/components/commons/CommonIcon.vue';
import CommonSpinner from '@/components/commons/CommonSpinner.vue';
import WizardCertificate from '@/components/WizardCertificate.vue';
import errorIcon from '@/assets/icons/status/error.svg';
import loadingIcon from '@/assets/icons/status/loading.svg';
import successIcon from '@/assets/icons/status/success.svg';

interface Props {
  initial: WizardState;
}

const props = defineProps<Props>();

const POLL_INTERVAL = 2000;
const LABELS: Record<StepId, string> = {
  download_gateway: 'stepDownloadGateway',
  download_ui: 'stepDownloadUi',
  install_gateway: 'stepInstallGateway',
  install_ui: 'stepInstallUi',
  configure: 'stepConfigure',
  account: 'stepAccount',
  certificate: 'stepCertificate',
  complete: 'stepComplete',
  handover: 'stepHandover',
};
const ICONS: Record<Exclude<InstallStep['state'], 'running'>, string> = {
  pending: loadingIcon,
  done: successIcon,
  failed: errorIcon,
};
const STATES: Record<Exclude<InstallStep['state'], 'running'>, string> = {
  pending: 'stepPending',
  done: 'stepDone',
  failed: 'stepFailed',
};

const state = ref<WizardState>(props.initial);
const root = ref<HTMLElement | null>(null);
const retrying = ref(false);
const error = ref('');

// Done, and the gateway is taking the port: what answers next is the NAS.
const handingOver = computed(() => state.value.phase === 'done' && !state.value.simulated);

/**
 * Waits for the gateway to serve the NAS, then opens login on the same origin. Keeping the browser's
 * port preserves forwarding. Refresh login first to replace a cached permanent HTTPS redirect
 * from an older gateway; do not follow any redirect while checking it.
 */
async function nasReady() {
  try {
    const response = await fetch('/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok && (await response.text()).trim() === 'ok') {
      const login = await fetch('/login', {
        cache: 'reload',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (login.ok) {
        window.location.assign('/login');
      }
    }
  } catch {
    // The port is changing hands: the next turn asks again.
  }
}

/**
 * Reads where the installation is; once it is done, waits for the NAS instead.
 */
async function refresh() {
  if (handingOver.value) {
    await nasReady();
    return;
  }
  if (state.value.phase !== 'installing') {
    return;
  }
  try {
    state.value = await request<WizardState>('/wizard');
  } catch {
    // The wizard is busy or restarting: the next turn asks again.
  }
}

async function retry() {
  retrying.value = true;
  error.value = '';
  try {
    state.value = await request<WizardState>('/wizard/retry', { method: 'POST' });
  } catch (reason) {
    error.value = failureMessage(reason);
  } finally {
    retrying.value = false;
  }
}

usePolling(refresh, ref(POLL_INTERVAL));

// The list fills the step: a failure brings the button that retries into view.
watch(
  () => state.value.phase,
  async (phase) => {
    if (phase === 'failed') {
      await nextTick();
      root.value?.lastElementChild?.scrollIntoView?.({ block: 'end' });
    }
  },
  { immediate: true },
);

</script>

<template>
  <div ref="root" class="wizard_install" data-testid="wizard_install">
    <ul class="app_list">
      <li
        v-for="step in state.steps"
        :key="step.id"
        class="wizard_install_step"
        :data-testid="`wizard_install_${step.id}`"
        :data-state="step.state"
      >
        <CommonSpinner v-if="step.state === 'running'" size="small" compact />
        <CommonIcon v-else :src="ICONS[step.state]" size="small" :label="t(STATES[step.state])" />
        <span class="wizard_install_name">{{ t(LABELS[step.id]) }}</span>
        <span v-if="step.state === 'done' && step.detail" class="muted">{{ step.detail }}</span>
        <pre v-if="step.state === 'failed'" class="wizard_install_detail">{{ step.detail }}</pre>
      </li>
    </ul>

    <WizardCertificate v-if="state.phase === 'ready'" @finished="state = $event" />

    <p
      v-if="state.phase === 'done' && state.simulated"
      class="muted"
      data-testid="wizard_simulated"
    >
      {{ t('installSimulated') }}
    </p>
    <CommonSpinner
      v-else-if="handingOver"
      :label="t('installHandover')"
      centered
      testid="wizard_handover"
    />

    <p v-if="error" role="alert" class="app_error">{{ error }}</p>

    <button
      v-if="state.phase === 'failed'"
      type="button"
      class="primary"
      :disabled="retrying"
      data-testid="wizard_retry"
      @click="retry"
    >
      <CommonSpinner v-if="retrying" size="small" compact />
      {{ t('retry') }}
    </button>
  </div>
</template>

<style scoped lang="scss">

.wizard_install {
  @extend %stack;
  gap: $space_4;
}

.wizard_install_step {
  @extend %panel_sunken;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: $space_3;
  padding: $space_3;
}

.wizard_install_name {
  flex: 1;
}

.wizard_install_detail {
  flex-basis: 100%;
  margin: 0;
  overflow-x: auto;
  color: var(--status-error);
  font-size: $text_label;
  white-space: pre-wrap;
}

</style>
