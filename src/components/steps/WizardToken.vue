<script setup lang="ts">

import { computed, ref, watch } from 'vue';
import { t } from '@/i18n';
import { request } from '@/api/client';
import { isToken } from '@/utils/loginValidation';
import { failureMessage } from '@/utils/failureMessage';
import type { RepositoryAccess } from '@/types/types';

import CommonField from '@/components/commons/CommonField.vue';
import CommonIcon from '@/components/commons/CommonIcon.vue';
import CommonPasswordInput from '@/components/commons/CommonPasswordInput.vue';
import CommonSpinner from '@/components/commons/CommonSpinner.vue';
import errorIcon from '@/assets/icons/status/error.svg';
import successIcon from '@/assets/icons/status/success.svg';
import verifyIcon from '@/assets/icons/system/verify.svg';

const token = defineModel<string>({ required: true });

const ACCESS: Record<RepositoryAccess['access'], string> = {
  ok: 'token.access.ok',
  refused: 'token.access.refused',
  forbidden: 'token.access.forbidden',
  missing: 'token.access.missing',
  unreachable: 'token.access.unreachable',
};

const touched = ref(false);
const checking = ref(false);
const answers = ref<RepositoryAccess[]>([]);
const failure = ref('');

const empty = computed(() => !token.value.trim());
const error = computed(() =>
  touched.value && !empty.value && !isToken(token.value) ? t('token.invalid') : '',
);

watch(token, () => {
  answers.value = [];
});

/**
 * Asks the wizard whether the token reads the releases it has to download, or whether they can be
 * read without one when the field is empty.
 */
async function check() {
  checking.value = true;
  failure.value = '';
  try {
    answers.value = await request<RepositoryAccess[]>('/wizard/token', {
      method: 'POST',
      body: JSON.stringify(empty.value ? {} : { token: token.value.trim() }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (reason) {
    failure.value = failureMessage(reason);
  } finally {
    checking.value = false;
  }
}

</script>

<template>
  <div class="wizard_token">
    <CommonField :error="error">
      <label for="wizard_token">{{ t('token.field') }}</label>
      <div class="wizard_token_controls">
        <CommonPasswordInput
          id="wizard_token"
          v-model="token"
          spellcheck="false"
          maxlength="512"
          :aria-invalid="!!error"
          data-testid="wizard_token"
          @focus="touched = true"
        />
        <button
          type="button"
          :disabled="checking || !!error"
          data-testid="wizard_token_check"
          @click="check"
        >
          <CommonSpinner v-if="checking" size="small" compact />
          <CommonIcon v-else :src="verifyIcon" size="small" tinted />
          {{ t('token.check') }}
        </button>
      </div>
    </CommonField>

    <p class="muted" data-testid="wizard_token_note">
      {{ t('token.emptyNote') }}
    </p>

    <p v-if="failure" role="alert" class="app_error">{{ failure }}</p>

    <ul v-if="answers.length" class="app_list" data-testid="wizard_token_answers">
      <li v-for="answer in answers" :key="answer.repository" class="wizard_token_answer">
        <CommonIcon
          :src="answer.access === 'ok' ? successIcon : errorIcon"
          size="small"
          :label="t(ACCESS[answer.access])"
        />
        <span class="wizard_token_repository">{{ answer.repository }}</span>
        <span class="muted">{{ t(ACCESS[answer.access]) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped lang="scss">

.wizard_token {
  @extend %stack;
  gap: $space_3;
}

.wizard_token_answer {
  @extend %fx_base;
  gap: $space_2;
}

.wizard_token_controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: start;
  gap: $space_2;

  button {
    font-size: $text_label;
    white-space: nowrap;
  }
}

.wizard_token_repository {
  margin-right: auto;
}

</style>
