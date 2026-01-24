export function generateStreamKey(length = 48): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let key = '';
  const random = cryptoGetRandomValues();
  for (let i = 0; i < 16; i++) {
    key += chars[(random >> (i * 4)) & 0x0f];
  }
  for (let i = 0; i < length; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

// Prefer secure randomness; fallback to Math.random if global crypto isn't available
function cryptoGetRandomValues() {
  if (
    typeof global !== 'undefined' &&
    (global as any).crypto &&
    (global as any).crypto.getRandomValues
  ) {
    return (global as any).crypto.getRandomValues(new Uint32Array(1))[0];
  }
  // fallback
  return Math.floor(Math.random() * 2 ** 32);
}
