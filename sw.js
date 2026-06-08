/* =============================================================================
 *  SERVICE WORKER — Mode hors ligne de l'Évaluateur Glacier
 * -----------------------------------------------------------------------------
 *  Met en cache la « coquille applicative » (HTML, JS, icônes, manifest) pour
 *  que l'application reste utilisable sans connexion une fois ouverte une
 *  première fois. Stratégie : cache-first avec repli réseau.
 *
 *  Pensez à incrémenter CACHE_VERSION à chaque modification des fichiers pour
 *  forcer la mise à jour côté utilisateurs.
 * ========================================================================== */
'use strict';

const CACHE_VERSION = 'eval-glacier-v3';

// Ressources locales (chemins relatifs au scope du service worker).
const ASSETS_LOCAUX = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
];

// Ressource externe (CDN Tailwind) — mise en cache « au mieux », sans bloquer
// l'installation si elle échoue (réseau filtré, etc.).
const ASSET_CDN = 'https://cdn.tailwindcss.com';

/* ---- Installation : pré-cache de la coquille applicative ---------------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(ASSETS_LOCAUX);              // obligatoire
    try {                                           // optionnel (cross-origin)
      await cache.add(new Request(ASSET_CDN, { mode: 'no-cors' }));
    } catch (e) { /* on ignore si le CDN est inaccessible */ }
    self.skipWaiting();                             // active la nouvelle version
  })());
});

/* ---- Activation : nettoyage des anciens caches -------------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cles = await caches.keys();
    await Promise.all(cles.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ---- Interception des requêtes : cache d'abord, réseau ensuite ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // on ne gère que les lectures

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const enCache = await cache.match(req, { ignoreSearch: true });
    if (enCache) return enCache;                    // réponse immédiate hors ligne

    try {
      const reponse = await fetch(req);
      // On met en cache les réponses valides de même origine pour la prochaine fois
      if (reponse && reponse.ok && new URL(req.url).origin === self.location.origin) {
        cache.put(req, reponse.clone());
      }
      return reponse;
    } catch (e) {
      // Hors ligne et non mis en cache : pour une navigation, on renvoie l'app.
      if (req.mode === 'navigate') return cache.match('./index.html');
      throw e;
    }
  })());
});
