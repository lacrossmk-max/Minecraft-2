// Simple offline cache for Blockwelt
const CACHE = 'blockwelt-v3';
const FILES = [
  '.', 'index.html', 'manifest.webmanifest', 'icon.svg',
  'lib/three.min.js',
  'js/noise.js', 'js/blocks.js', 'js/world.js', 'js/player.js',
  'js/mobs.js', 'js/ui.js', 'js/main.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
