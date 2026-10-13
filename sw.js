/* Om Nom Offline: service worker of the web build (D-418).
 *
 * The shell of the game (index.html, Build/* = loader, framework, wasm, data, the manifest, the icons, privacy.html) is kept in the Cache Storage under a name that carries
 * the id of the build, so the game starts without a network after the first visit. The id arrives in the address of this script (sw.js?b=<id>, written into index.html by
 * the build post-process, Omnom.EditorTools.WebTemplateStamp): a new build = a new address = the browser installs a new worker at once, which takes the page over
 * and throws the caches of older builds away; nothing sticks to an old build.
 *
 * The game packs (StreamingAssets/packs/<name>-<hash>.bundle) are not touched here: the engine keeps them itself (cacheControl "immutable" in index.html,
 * its IndexedDB cache), a game entered once opens again without network.
 */
"use strict";

const BUILD = new URL(self.location.href).searchParams.get("b") || "dev";
const PREFIX = "omnom-shell-";
const CACHE = PREFIX + BUILD;
const SCOPE = self.registration.scope;
const INDEX = SCOPE + "index.html";
// small files that the page does not fetch before the worker exists; Build/<loader> is requested by the page itself right after the worker takes control (see index.html)
const SHELL = ["index.html", "manifest.webmanifest", "privacy.html", "favicon.ico", "favicon-16.png", "favicon-32.png", "apple-touch-icon-180.png",
  "icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // one by one: a missing optional file must not fail the installation
    await Promise.all(SHELL.map(async (name) => {
      try {
        const res = await fetch(new Request(SCOPE + name, { cache: "reload" }));
        if (res.ok) await cache.put(SCOPE + name, res);
      } catch (e) { /* offline during the installation: the page puts what it loads */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// the start page (the address of the site with or without index.html, any ?query): its own file names change with a build, so it is asked from the network first
function isIndex(url) {
  return url.pathname === new URL(SCOPE).pathname || url.pathname === new URL(INDEX).pathname;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" && request.method !== "HEAD") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !request.url.startsWith(SCOPE)) return;
  if (url.pathname.endsWith("sw.js")) return;
  if (url.pathname.indexOf("StreamingAssets/") >= 0) return;       // the packs: the engine's own cache
  if (request.headers.has("range")) return;
  event.respondWith(handle(request, url));
});

async function handle(request, url) {
  const cache = await caches.open(CACHE);
  if (isIndex(url)) {
    // the page: the network first (a new build is seen at once), the cached one when there is no network
    try {
      const res = await fetch(request);
      if (res.ok && request.method === "GET") cache.put(INDEX, res.clone());
      return res;
    } catch (e) {
      const hit = await cache.match(INDEX);
      if (hit) return hit;
      throw e;
    }
  }
  const key = url.origin + url.pathname;
  let hit = await cache.match(key);
  if (hit) {
    if (request.method === "HEAD") return new Response(null, { status: hit.status, statusText: hit.statusText, headers: hit.headers });
    return hit;
  }
  const res = await fetch(request);
  // 200 only (a 206 or an opaque answer is not stored); the copy is written while the page reads the original
  if (res.status === 200 && request.method === "GET") cache.put(key, res.clone()).catch(() => {});
  return res;
}
