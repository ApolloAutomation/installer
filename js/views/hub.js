// js/views/hub.js — real implementation in Task 6
export function renderHub(el, registry) {
  el.innerHTML = `<p class="loading">Hub view: ${registry.devices.length} devices (Task 6).</p>`;
}
