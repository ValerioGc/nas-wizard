<script setup lang="ts">

import { onMounted, ref } from 'vue';
import { t } from '@/i18n';
import { request } from '@/api/client';
import type { WizardNetwork, WizardNetworks } from '@/types/types';

import CommonField from '@/components/commons/CommonField.vue';
import CommonIcon from '@/components/commons/CommonIcon.vue';
import CommonPasswordInput from '@/components/commons/CommonPasswordInput.vue';
import CommonSpinner from '@/components/commons/CommonSpinner.vue';
import lanIcon from '@/assets/icons/network/lan.svg';
import lockIcon from '@/assets/icons/network/lock.svg';
import wifiIcon from '@/assets/icons/network/wifi.svg';
import refreshIcon from '@/assets/icons/system/refresh.svg';
import { failureMessage } from '@/utils/failureMessage';

const CONNECT_TIMEOUT = 60000;
const SCAN_TIMEOUT = 30000;

const state = ref<WizardNetworks | null>(null);
// Whether the NAS is on a network: the wizard downloads from GitHub once the choices are made.
const connected = defineModel<boolean>('connected', { default: false });
const emit = defineEmits<{ connection: [value: WizardNetworks['connection']] }>();
const scanning = ref(false);
const chosen = ref<WizardNetwork | null>(null);
const password = ref('');
const joining = ref(false);
const error = ref('');

function needsPassword(network: WizardNetwork) {
  return !network.known && network.security !== 'open';
}

/**
 * Sends one request of the step and keeps the network state it answers with.
 */
async function send(path: string, body: object, timeout: number) {
  error.value = '';
  try {
    state.value = await request<WizardNetworks>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    connected.value = state.value.connection.connected;
    emit('connection', state.value.connection);
    return true;
  } catch (reason) {
    error.value = failureMessage(reason);
    return false;
  }
}

async function scan() {
  scanning.value = true;
  chosen.value = null;
  await send('/wizard/network/scan', {}, SCAN_TIMEOUT);
  scanning.value = false;
}

function choose(network: WizardNetwork) {
  chosen.value = chosen.value?.ssid === network.ssid ? null : network;
  password.value = '';
}

async function join(network: WizardNetwork) {
  const body = needsPassword(network)
    ? { ssid: network.ssid, password: password.value }
    : { ssid: network.ssid };
  joining.value = true;
  if (await send('/wizard/network/wifi', body, CONNECT_TIMEOUT)) {
    chosen.value = null;
    password.value = '';
  }
  joining.value = false;
}

onMounted(scan);

</script>

<template>
  <div class="wizard_network">
    <div class="wizard_network_current">
      <template v-if="state?.connection.connected">
        <CommonIcon :src="state.connection.kind === 'wifi' ? wifiIcon : lanIcon" />
        <span data-testid="wizard_network_current">
          {{ t('connectedTo', { name: state.connection.ssid ?? t('wiredConnection') }) }}
        </span>
      </template>
      <button
        type="button"
        class="wizard_network_scan"
        :disabled="scanning || joining"
        :aria-label="t('scan')"
        :title="t('scan')"
        data-testid="wizard_network_scan"
        @click="scan"
      >
        <CommonIcon :src="refreshIcon" />
      </button>
    </div>

    <CommonSpinner
      v-if="scanning"
      :label="t('scanningNetworks')"
      centered
      testid="wizard_network_scanning"
    />

    <template v-else>
      <p v-if="error" role="alert" class="app_error">{{ error }}</p>
      <p v-if="state && !state.canConnect" class="muted">{{ t('wizardNetworkFixed') }}</p>
      <p v-if="state && !state.wifi.length" class="muted">
        {{ state.wifiNote ?? t('noNetworks') }}
      </p>

      <ul v-if="state?.wifi.length" class="app_list">
        <li
          v-for="network in state.wifi"
          :key="network.ssid"
          class="wizard_network_row"
          :class="{ wizard_network_chosen: chosen?.ssid === network.ssid }"
        >
          <button
            type="button"
            class="wizard_network_option"
            :aria-expanded="chosen?.ssid === network.ssid"
            :disabled="!state.canConnect || joining"
            :data-testid="`wizard_network_${network.ssid}`"
            @click="choose(network)"
          >
            <CommonIcon :src="wifiIcon" />
            <span class="wizard_network_ssid">{{ network.ssid }}</span>
            <CommonIcon
              v-if="network.security !== 'open'"
              :src="lockIcon"
              size="small"
              :label="t('security')"
            />
            <span class="muted">{{ network.signal }}%</span>
          </button>

          <form
            v-if="chosen?.ssid === network.ssid"
            class="wizard_network_join"
            @submit.prevent="join(network)"
          >
            <CommonField v-if="needsPassword(network)" class="wizard_network_password">
              <label for="wizard_network_password">{{ t('networkPassword') }}</label>
              <CommonPasswordInput
                id="wizard_network_password"
                v-model="password"
                minlength="8"
                maxlength="64"
                required
                data-testid="wizard_network_password"
              />
            </CommonField>
            <button
              type="submit"
              class="primary"
              :disabled="joining"
              data-testid="wizard_network_join"
            >
              <CommonSpinner v-if="joining" size="small" compact />
              {{ t(joining ? 'connecting' : 'connect') }}
            </button>
          </form>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped lang="scss">

.wizard_network {
  @extend %stack;
  gap: $space_3;
}

.wizard_network_current {
  @extend %fx_base;
  gap: $space_2;
  min-height: $space_10;
}

.wizard_network_scan {
  @extend %icon_button;
  margin-left: auto;
}

.wizard_network_row {
  @extend %panel_sunken;
  transition: border-color $duration_fast;
}

.wizard_network_chosen {
  border-color: var(--accent);
}

.wizard_network_option {
  @extend %icon_button;
  justify-content: flex-start;
  gap: $space_3;
  width: 100%;
  padding: $space_3;
  text-align: start;
}

.wizard_network_ssid {
  @extend %truncated_text;
  margin-right: auto;
}

.wizard_network_join {
  display: flex;
  align-items: flex-end;
  gap: $space_3;
  padding: 0 $space_3 $space_3;
}

.wizard_network_password {
  flex: 1;
}

</style>
