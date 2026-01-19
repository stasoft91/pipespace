<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import type { ModulationPanelModel } from '../modulation-panel-model';
import LfoEditor from './LfoEditor.vue';
import LfoList from './LfoList.vue';
import RegionOverlay from './RegionOverlay.vue';
import ContextMenu from './ContextMenu.vue';

type Props = {
  model: ModulationPanelModel;
  overlayContainer: HTMLElement;
  menuRoot: HTMLElement;
};

const props = defineProps<Props>();
const model = props.model;
const overlayContainer = props.overlayContainer;
const menuRoot = props.menuRoot;

const onDocumentClick = () => model.closeContextMenu();
const onWindowBlur = () => model.closeContextMenu();
const onWindowKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') model.closeContextMenu();
};

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('keydown', onWindowKeyDown);
});

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick);
  window.removeEventListener('blur', onWindowBlur);
  window.removeEventListener('keydown', onWindowKeyDown);
});
</script>

<template>
  <LfoList :model="model" />
  <LfoEditor :model="model" />
  <Teleport :to="overlayContainer">
    <RegionOverlay :model="model" :overlay-container="overlayContainer" />
  </Teleport>
  <Teleport :to="menuRoot">
    <ContextMenu :model="model" />
  </Teleport>
</template>
