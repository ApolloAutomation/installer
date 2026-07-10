// js/views/hub.js — device grid with category filters
export function renderHub(el, registry) {
  const cats = [...new Set(registry.devices.map((d) => d.category))];
  el.innerHTML = `
    <section class="hero">
      <h1>Flash your Apollo device from the browser</h1>
      <p>Plug in your device via USB, choose your device below, and you'll be running the latest firmware in minutes!</p>
    </section>
    <div class="filters">
      <button data-cat="all" class="active" aria-pressed="true">All devices</button>
      ${cats.map((c) => `<button data-cat="${c}" aria-pressed="false">${c}</button>`).join('')}
    </div>
    <div class="device-grid">
      ${registry.devices.map((d) => `
        <a class="device-card" href="#/${d.id}" data-cat="${d.category}">
          <img src="${d.image}" alt="${d.name}" loading="lazy">
          <h3>${d.name}</h3>
          <p>${d.description}</p>
          <span class="go">Install →</span>
        </a>`).join('')}
    </div>`;

  el.querySelector('.filters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cat]');
    if (!btn) return;
    el.querySelectorAll('.filters button').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    el.querySelectorAll('.device-card').forEach((card) => {
      card.style.display =
        btn.dataset.cat === 'all' || card.dataset.cat === btn.dataset.cat ? '' : 'none';
    });
  });
}
