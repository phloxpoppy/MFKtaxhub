'use strict';

const status = document.getElementById('status');
const button = document.getElementById('openApp');
const build = `refresh-${Date.now()}`;
let fallbackTimer;

const withTimeout = (promise, milliseconds = 4000) => Promise.race([
  promise,
  new Promise(resolve => setTimeout(resolve, milliseconds))
]);

async function finish(message) {
  clearTimeout(fallbackTimer);
  status.className = 'done';
  status.textContent = message;
  button.hidden = false;
  button.onclick = () => location.replace(`/?v=${build}`);
}

async function refreshApp() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await withTimeout(navigator.serviceWorker.getRegistrations());
      await withTimeout(Promise.all((registrations || []).map(registration => {
        registration.waiting?.postMessage('SKIP_WAITING');
        return registration.unregister();
      })));
    }
    if ('caches' in window) {
      const keys = await withTimeout(caches.keys());
      await withTimeout(Promise.all((keys || []).map(key => caches.delete(key))));
    }
    await finish('Cache lama telah dibuang. Tekan butang di bawah untuk membuka versi terkini.');
  } catch (error) {
    await finish('Safari telah disegarkan. Tekan butang di bawah untuk membuka aplikasi versi terkini.');
  }
}

fallbackTimer = setTimeout(() => finish('Proses mengambil masa lebih lama daripada biasa. Tekan butang di bawah untuk membuka versi terkini.'), 5000);
refreshApp();
