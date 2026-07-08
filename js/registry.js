let cache = null;

export async function loadRegistry() {
  if (cache) return cache;
  const res = await fetch('devices.json');
  if (!res.ok) throw new Error(`Could not load the device list (HTTP ${res.status}).`);
  const reg = await res.json();
  if (!Array.isArray(reg.devices) || reg.devices.length === 0) {
    throw new Error('The device list is empty or malformed.');
  }
  cache = reg;
  return reg;
}
