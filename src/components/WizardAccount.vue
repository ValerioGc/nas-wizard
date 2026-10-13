<script setup lang="ts">

import { computed, reactive } from 'vue';
import { t } from '@/i18n';
import { validateAccount } from '@/utils/loginValidation';
import CommonField from '@/components/commons/CommonField.vue';
import CommonPasswordInput from '@/components/commons/CommonPasswordInput.vue';

const username = defineModel<string>('username', { required: true });
const password = defineModel<string>('password', { required: true });
const confirm = defineModel<string>('confirm', { required: true });

const touched = reactive({ username: false, password: false, confirm: false });
const errors = computed(() => validateAccount(username.value, password.value, confirm.value));

const shown = (field: keyof typeof touched) => (touched[field] ? errors.value[field] : '');

</script>

<template>
  <div class="wizard_fields">
    <CommonField :error="shown('username')">
      <label for="wizard_username">{{ t('usernameLabel') }}</label>
      <input
        id="wizard_username"
        v-model="username"
        type="text"
        autocomplete="username"
        maxlength="25"
        :aria-invalid="!!shown('username')"
        data-testid="wizard_username"
        @focus="touched.username = true"
      />
    </CommonField>

    <CommonField :error="shown('password')">
      <label for="wizard_password">{{ t('passwordLabel') }}</label>
      <CommonPasswordInput
        id="wizard_password"
        v-model="password"
        new-password
        maxlength="128"
        :aria-invalid="!!shown('password')"
        data-testid="wizard_password"
        @focus="touched.password = true"
      />
    </CommonField>

    <CommonField :error="shown('confirm')">
      <label for="wizard_confirm">{{ t('confirmPassword') }}</label>
      <CommonPasswordInput
        id="wizard_confirm"
        v-model="confirm"
        new-password
        maxlength="128"
        :aria-invalid="!!shown('confirm')"
        data-testid="wizard_confirm"
        @focus="touched.confirm = true"
      />
    </CommonField>
  </div>
</template>

<style scoped lang="scss">

.wizard_fields {
  @extend %stack;
  gap: $space_4;
}

</style>
