let cache = null;

export async function loadRegistry() {
  if (cache) return cache;
  // no-cache revalidates (cheap, ETag) instead of trusting Pages' 10-minute
  // max-age, so a registry fix reaches the next page load.
  const res = await fetch('devices.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load the device list (HTTP ${res.status}).`);
  let reg;
  try {
    reg = await res.json();
  } catch {
    throw new Error('The device list could not be read.');
  }
  if (!Array.isArray(reg.devices) || reg.devices.length === 0) {
    throw new Error('The device list is empty or malformed.');
  }
  cache = reg;
  return reg;
}
