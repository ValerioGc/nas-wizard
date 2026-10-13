<script setup lang="ts">

import { computed, onMounted, reactive, ref, watch } from 'vue';
import { locale, setLocale, t } from '@/i18n';
import { request } from '@/api/client';
import { useAppearance } from '@/composables/useAppearance';
import { failureMessage } from '@/utils/failureMessage';
import { isNasName, isToken, validateAccount } from '@/utils/loginValidation';
import type { Configuration, Locale, Theme, WizardState } from '@/types/types';

import AlertBanner from '@/components/alerts/AlertBanner.vue';
import CommonSpinner from '@/components/commons/CommonSpinner.vue';
import WizardAccount from '@/components/WizardAccount.vue';
import WizardAppearance from '@/components/WizardAppearance.vue';
import WizardInstall from '@/components/WizardInstall.vue';
import WizardNetwork from '@/components/WizardNetwork.vue';
import WizardProgress from '@/components/WizardProgress.vue';
import WizardStep from '@/components/WizardStep.vue';
import WizardToken from '@/components/WizardToken.vue';

type Step = 'welcome' | 'account' | 'appearance' | 'network' | 'token' | 'summary';

// Steps and their corresponding titles and descriptions for the wizard.
const STEPS: Step[] = ['welcome', 'account', 'appearance', 'network', 'token', 'summary'];
const TITLES: Record<Step, [string, string]> = {
  welcome: ['wizardTitle', 'wizardIntro'],
  account: ['wizardAccountTitle', 'wizardAccountIntro'],
  appearance: ['wizardAppearanceTitle', 'wizardAppearanceIntro'],
  network: ['wizardNetworkTitle', 'wizardNetworkIntro'],
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
const unreachable = ref('');

const step = computed(() => STEPS[position.value] ?? 'welcome');
const installing = computed(() => !!wizard.value && wizard.value.phase !== 'collecting');
const title = computed(() => (installing.value ? t('installTitle') : t(TITLES[step.value][0])));
const description = computed(() =>
  installing.value ? t('installIntro') : t(TITLES[step.value][1]),
);
const tokenSummary = computed(() => (token.value.trim() ? 'tokenSet' : 'tokenNotSet'));
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
  };
  try {
    wizard.value = await request<WizardState>('/wizard/install', {
      method: 'POST',
      body: JSON.stringify(configuration),
    });
  } catch (reason) {
    const message = failureMessage(reason);
    if (message.includes('account name') || message.includes('the name takes')) {
      position.value = STEPS.indexOf('account');
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
        <WizardProgress v-if="position > 0" :current="position" :total="STEPS.length - 1" />

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

        <WizardNetwork v-else-if="step === 'network'" v-model:connected="connected" />

        <WizardToken v-else-if="step === 'token'" v-model="token" />

        <template v-else-if="step === 'summary'">
          <dl class="wizard_summary" data-testid="wizard_summary">
            <dt>{{ t('usernameLabel') }}</dt>
            <dd>{{ account.username.trim() }}</dd>
            <dt>{{ t('nasName') }}</dt>
            <dd>{{ nasName.trim() }}</dd>
            <dt>{{ t('language') }}</dt>
            <dd>{{ t(language === 'it' ? 'italian' : 'english') }}</dd>
            <dt>{{ t('theme') }}</dt>
            <dd>{{ t(theme) }}</dd>
            <dt>{{ t('tokenField') }}</dt>
            <dd>{{ t(tokenSummary) }}</dd>
          </dl>
          <p class="muted">{{ t('wizardInstallNote') }}</p>
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
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: $space_2 $space_4;
}

</style>
