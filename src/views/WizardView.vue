<script setup lang="ts">

import { computed, onMounted, reactive, ref, watch } from 'vue';
import { locale, setLocale, t } from '@/i18n';
import { request } from '@/api/client';
import { useAppearance } from '@/composables/useAppearance';
import { failureMessage } from '@/utils/failureMessage';
import { isNasName, isToken, validateAccount } from '@/utils/loginValidation';
import type {
  Configuration,
  DiskChoice,
  DiskPlan,
  Locale,
  Theme,
  WizardDisks as DisksOffer,
  WizardNetworks,
  WizardState,
} from '@/types/types';

import AlertBanner from '@/components/alerts/AlertBanner.vue';
import CommonSpinner from '@/components/commons/CommonSpinner.vue';
import CommonIcon from '@/components/commons/CommonIcon.vue';
import WizardAccount from '@/components/WizardAccount.vue';
import WizardAppearance from '@/components/WizardAppearance.vue';
import WizardDisks from '@/components/WizardDisks.vue';
import WizardInstall from '@/components/WizardInstall.vue';
import WizardNetwork from '@/components/WizardNetwork.vue';
import WizardProgress from '@/components/WizardProgress.vue';
import WizardStep from '@/components/WizardStep.vue';
import WizardToken from '@/components/WizardToken.vue';
import logoSource from '@/assets/logo.svg';
import infoIcon from '@/assets/icons/status/info.svg';

type Step = 'welcome' | 'account' | 'appearance' | 'network' | 'disks' | 'token' | 'summary';

// Steps and their corresponding titles and descriptions for the wizard. The data disks are a step
// only where the wizard prepares them.
const STEPS: Step[] = ['welcome', 'account', 'appearance', 'network', 'token', 'summary'];
const DISK_STEPS: Step[] = [
  'welcome',
  'account',
  'appearance',
  'network',
  'disks',
  'token',
  'summary',
];
const TITLES: Record<Step, [string, string]> = {
  welcome: ['wizardTitle', 'wizardIntro'],
  account: ['wizardAccountTitle', 'wizardAccountIntro'],
  appearance: ['wizardAppearanceTitle', 'wizardAppearanceIntro'],
  network: ['wizardNetworkTitle', 'wizardNetworkIntro'],
  disks: ['wizardDisksTitle', 'wizardDisksIntro'],
  token: ['wizardTokenTitle', 'wizardTokenIntro'],
  summary: ['wizardSummaryTitle', 'wizardSummaryIntro'],
};

const position = ref(0);
const account = reactive({ username: '', password: '', confirm: '' });
const nasName = ref('nas');
const language = ref<Locale>(locale.value);
const theme = ref<Theme>('system');
const token = ref('');
const busy = ref(false);
const error = ref('');
// Where the wizard is, as it says: null until it answers.
const wizard = ref<WizardState | null>(null);
const connected = ref(false);
const connection = ref<WizardNetworks['connection'] | null>(null);
const unreachable = ref('');
const disks = ref<DisksOffer>({ enabled: false, encryption: false, disks: [] });
const plans = ref<Record<string, DiskPlan>>({});

const steps = computed(() => (disks.value.enabled ? DISK_STEPS : STEPS));
const step = computed(() => steps.value[position.value] ?? 'welcome');
// The empty disks to initialize, as the wizard wants them.
const chosen = computed<DiskChoice[]>(() =>
  disks.value.disks
    .filter((disk) => disk.empty && (plans.value[disk.device] ?? 'keep') !== 'keep')
    .map((disk) => ({
      device: disk.device,
      identity: disk.identity,
      encrypt: plans.value[disk.device] === 'encrypted',
    })),
);
const disksSummary = computed(() =>
  chosen.value.length
    ? chosen.value
        .map((disk) =>
          disk.encrypt ? `${disk.device} (${t('wizardDiskEncryptedShort')})` : disk.device,
        )
        .join(', ')
    : t('wizardDisksSummaryNone'),
);
const installing = computed(() => !!wizard.value && wizard.value.phase !== 'collecting');
const title = computed(() => (installing.value ? t('installTitle') : t(TITLES[step.value][0])));
const description = computed(() =>
  installing.value ? t('installIntro') : t(TITLES[step.value][1]),
);
const tokenSummary = computed(() => (token.value.trim() ? 'tokenSet' : 'tokenNotSet'));
const networkSummary = computed(() => {
  const current = connection.value;
  if (!current?.connected) {
    return t('wizardCurrentConnection');
  }
  if (current.kind === 'wifi') {
    return current.ssid ? `Wi-Fi · ${current.ssid}` : 'Wi-Fi';
  }
  return t('wiredConnection');
});
const summary = computed(() => [
  { label: 'usernameLabel', value: account.username.trim() },
  { label: 'passwordLabel', value: t('wizardPasswordSet'), status: true },
  { label: 'wizardConnection', value: networkSummary.value },
  { label: 'language', value: t(language.value === 'it' ? 'italian' : 'english') },
  { label: 'theme', value: t(theme.value) },
  { label: 'tokenField', value: t(tokenSummary.value), status: !!token.value.trim() },
  ...(disks.value.enabled ? [{ label: 'wizardDisksSummary', value: disksSummary.value }] : []),
]);
const ready = computed(() => {
  if (step.value === 'account') {
    return !Object.values(
      validateAccount(account.username, account.password, account.confirm),
    ).some(Boolean);
  }

  if (step.value === 'appearance') {
    return isNasName(nasName.value);
  }

  if (step.value === 'network') {
    return connected.value;
  }

  return step.value !== 'token' || !token.value.trim() || isToken(token.value);
});

watch(language, setLocale);
useAppearance(theme);

async function load() {
  unreachable.value = '';
  try {
    wizard.value = await request<WizardState>('/wizard');
  } catch (reason) {
    unreachable.value = failureMessage(reason);
    return;
  }
  // A wizard that cannot list its disks leaves them out of the configuration.
  const offer = await request<DisksOffer>('/wizard/disks').catch(() => null);
  if (Array.isArray(offer?.disks)) {
    disks.value = offer;
  }
}

/**
 * Hands the choices to the wizard, which checks them and starts installing. A name the system
 * refuses brings back the account step.
 */
async function finish() {
  busy.value = true;
  error.value = '';
  const configuration: Configuration = {
    username: account.username.trim(),
    password: account.password,
    language: language.value,
    theme: theme.value,
    nasName: nasName.value.trim(),
    ...(token.value.trim() ? { token: token.value.trim() } : {}),
    ...(chosen.value.length ? { disks: chosen.value } : {}),
  };
  try {
    wizard.value = await request<WizardState>('/wizard/install', {
      method: 'POST',
      body: JSON.stringify(configuration),
    });
  } catch (reason) {
    const message = failureMessage(reason);
    if (message.includes('account name') || message.includes('the name takes')) {
      position.value = steps.value.indexOf('account');
    }
    error.value = t('wizardFailed', { reason: message });
  } finally {
    busy.value = false;
  }
}

onMounted(load);

</script>

<template>
  <main class="app_surface wizard_page" data-testid="wizard_page">
    <WizardStep :title="title" :description="description" :logo="!installing && step === 'welcome'">
      <template v-if="!wizard">
        <AlertBanner v-if="unreachable" tone="error" compact>{{ unreachable }}</AlertBanner>
        <CommonSpinner v-else :label="t('wizardLoading')" centered />
      </template>

      <WizardInstall v-else-if="installing" :initial="wizard" />

      <template v-else>
        <WizardProgress v-if="position > 0" :current="position" :total="steps.length - 1" />

        <WizardAccount
          v-if="step === 'account'"
          v-model:username="account.username"
          v-model:password="account.password"
          v-model:confirm="account.confirm"
        />

        <WizardAppearance
          v-else-if="step === 'appearance'"
          v-model:name="nasName"
          v-model:language="language"
          v-model:theme="theme"
        />

        <WizardNetwork
          v-else-if="step === 'network'"
          v-model:connected="connected"
          @connection="connection = $event"
        />

        <WizardDisks v-else-if="step === 'disks'" v-model="plans" :offer="disks" />

        <WizardToken v-else-if="step === 'token'" v-model="token" />

        <template v-else-if="step === 'summary'">
          <section
            class="wizard_summary"
            :aria-label="t('wizardSummaryTitle')"
            data-testid="wizard_summary"
          >
            <header class="wizard_summary_header">
              <img :src="logoSource" alt="" />
              <div>
                <p class="muted">{{ t('nasName') }}</p>
                <h2>{{ nasName.trim() }}</h2>
              </div>
            </header>
            <dl class="wizard_summary_details">
              <div v-for="detail in summary" :key="detail.label" class="wizard_summary_row">
                <dt>{{ t(detail.label) }}</dt>
                <dd :class="{ wizard_summary_status: detail.status }">{{ detail.value }}</dd>
              </div>
            </dl>
          </section>
          <p class="muted wizard_summary_note">
            <CommonIcon :src="infoIcon" size="small" />
            <span>{{ t('wizardInstallNote') }}</span>
          </p>
        </template>

        <AlertBanner v-if="error" tone="error" compact>{{ error }}</AlertBanner>
      </template>

      <template v-if="wizard && !installing" #actions>
        <button
          v-if="position > 0"
          type="button"
          :disabled="busy"
          data-testid="wizard_back"
          @click="position--"
        >
          {{ t('back') }}
        </button>

        <button
          v-if="step === 'welcome'"
          type="button"
          class="primary"
          data-testid="wizard_start"
          @click="position++"
        >
          {{ t('wizardConfigure') }}
        </button>
        <button
          v-else-if="step === 'summary'"
          type="button"
          class="primary"
          :disabled="busy"
          data-testid="wizard_finish"
          @click="finish"
        >
          <CommonSpinner v-if="busy" size="small" compact />
          {{ t('wizardComplete') }}
        </button>
        <button
          v-else
          type="button"
          class="primary"
          :disabled="!ready"
          data-testid="wizard_next"
          @click="position++"
        >
          {{ t('next') }}
        </button>
      </template>
    </WizardStep>
  </main>
</template>

<style scoped lang="scss">

.wizard_page {
  @extend %centered_page;
}

.wizard_summary {
  @extend %panel_sunken;
  padding: $space_4;
}

.wizard_summary_header {
  display: flex;
  align-items: center;
  gap: $space_3;
  padding-bottom: $space_3;
  margin-bottom: $space_2;
  border-bottom: $border_thin solid var(--surface-border);

  img {
    width: $space_10;
    height: $space_10;
    flex-shrink: 0;
  }

  h2 {
    overflow-wrap: anywhere;
  }
}

.wizard_summary_details {
  margin: 0;
}

.wizard_summary_row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  align-items: baseline;
  gap: $space_3;
  padding-block: $space_2 * 0.75;
  font-size: $text_label;

  dt {
    color: var(--surface-muted);
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
    font-weight: 600;
    text-align: end;
  }
}

.wizard_summary_status {
  color: var(--status-success);
}

.wizard_summary_note {
  display: flex;
  align-items: flex-start;
  gap: $space_2;

  :deep(.common_icon) {
    flex-shrink: 0;
    margin-top: 0.2em;
  }
}

</style>
