<template>
  <div class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 1090">
    <div
      v-for="item in toasts.items"
      :key="item.id"
      class="toast show align-items-center border-0 mb-2"
      :class="`text-bg-${item.type}`"
      role="alert"
    >
      <div class="d-flex">
        <div class="toast-body">{{ item.message }}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" @click="removeToast(item.id)"></button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useToasts, removeToast } from '../composables/useToast';

const toasts = useToasts();
</script>
