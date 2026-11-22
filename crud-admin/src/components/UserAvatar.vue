<template>
  <img v-if="src" :src="src" class="rounded-circle" :class="sizeClass" alt="" />
  <span v-else class="avatar-initial" :class="sizeClass">{{ initial }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ src?: string; name?: string; size?: 'sm' | 'lg' }>(), {
  src: '',
  name: '',
  size: 'sm',
});

const sizeClass = computed(() => (props.size === 'lg' ? 'avatar-lg' : 'avatar-sm'));
const initial = computed(() => (props.name || '?').trim().charAt(0).toUpperCase());
</script>
