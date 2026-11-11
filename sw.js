/* Beaver Cook service worker: the app shell works offline, and the recipe data is cached the first time it is fetched.
   The build writes VERSION, DATA, FILES, CORE and ALL_DATA; a new build means a new VERSION. Beaver Reader and Beaver
   Focus share this origin, so only caches starting "cook-" are ever touched.
   The shell and its data come as a pair: while this worker controls the page, data/manifest.json is the one it
   installed (every data release ships a new sw.js), so an old shell never reads a newer manifest. A new worker waits
   until the page lets it take over (register-sw.js: the "new recipes" toast, or the next load when nobody is cooking). */
const VERSION = 'cook-shell-ea1543632b2a';                     // cook-shell-<hash of every shell file>
const DATA = 'cook-data-90e2438fac05';                           // cook-data-<manifest.version>
const FONTS = 'cook-cjk-fonts-1';                  // the big pixel CJK fonts: filled when first used, kept across versions
const FILES = ["./","assets/Board-g8VjfxS6.js","assets/BoxStock-9hkWKsc5.js","assets/CookMode-C6Dm2MjD.js","assets/Packs-C1K_RN2R.js","assets/PasteList-2_LR4vQn.js","assets/PlanPage-De-B328l.js","assets/PlanSetup-YvsE9BQz.js","assets/PlanToast-DFK2g-bR.js","assets/PlanWeekButton-Cb3sn2UI.js","assets/ShopPage-BKrt9GYq.js","assets/SlotMenu-B4dGcnj5.js","assets/Taste-CwRk0h_G.js","assets/TipBubble-CPxJTyZ6.js","assets/TonightShop-CwcZQzME.js","assets/WeekPick-Cq_wqu8k.js","assets/add-missing-BWajdG6t.js","assets/backup-BNBm_vb1.js","assets/cook-view-LGz0glQl.js","assets/index-DblChhmb.css","assets/index-DkBjzwZI.js","assets/index-RFsehim-.js","assets/match.worker-ChUYu9zo.js","assets/never-Ck3G_sTH.js","assets/plan-DjcHq4qy.js","assets/planner-JnHiPvKc.js","assets/releases-CfcgT5mc.js","assets/shop-BYDGyAVY.js","assets/shop-hooks-CEaAkGyq.js","assets/silkscreen-latin-CtPo2yA5.woff2","assets/silkscreen-latin-ext-2T9bWrxp.woff2","assets/suggest-CFjuBDgZ.js","assets/taste-BlHlXZK-.js","assets/taste-DwicJTsL.js","assets/tips-CT272HRt.js","icons/apple-touch-icon.png","icons/favicon-32.png","icons/favicon.svg","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","index.html","manifest.webmanifest","robots.txt"];                           // the shell (everything but data/ and the CJK fonts)
const CORE = ["data/manifest.json","data/vocab-ef84be8679.json","data/match-e39be153d8.bin","data/meta-dc52162061.json"];                             // data needed before the first recipe list: manifest, vocab, match index, meta
const ALL_DATA = ["data/credits-cb86bdbf8d.json","data/match-e39be153d8.bin","data/meta-dc52162061.json","data/recipes-0-3131658631.json","data/recipes-1-a78a8c0b2b.json","data/recipes-10-4c43449409.json","data/recipes-11-1363b20429.json","data/recipes-12-9f30ff5334.json","data/recipes-13-e664f355e8.json","data/recipes-2-66e8033287.json","data/recipes-3-ca843e79e7.json","data/recipes-4-d1e6daafba.json","data/recipes-5-28315d10e5.json","data/recipes-6-767bba483a.json","data/recipes-7-2e99405ac5.json","data/recipes-8-88ac3a8063.json","data/recipes-9-ef5c9f30da.json","data/sample-5c95527847.json","data/vocab-ef84be8679.json"];                     // every content-hashed file under data/ (all but manifest.json)

const isManifest = url => url.pathname.endsWith('/data/manifest.json');
const isData = url => url.pathname.includes('/data/');
const isFont = url => url.pathname.includes('/fonts/fusion-pixel/');

// a new data release re-uses every file an older data cache already holds (the files are content-hashed, so the same
// name is the same bytes); only the ones that are really new get downloaded
async function carryOver(fresh) {
  for (const k of await caches.keys()) {
    if (!k.startsWith('cook-data-') || k === DATA) continue;
    const old = await caches.open(k);
    for (const f of ALL_DATA) {
      if (await fresh.match(f)) continue;
      const hit = await old.match(f);
      if (hit) await fresh.put(f, hit);
    }
  }
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const shell = await caches.open(VERSION);
    await shell.addAll(FILES.map(f => new Request(f, { cache: 'reload' })));
    const data = await caches.open(DATA);
    await carryOver(data);
    // the page fetches these before this worker controls it on the very first visit, so they are fetched here too
    // (normal cache mode: the browser's own copy is fine, they are content-hashed; only the manifest must be fresh, and
    // it must be this release's: one from a newer deploy fails the install, and the browser tries the newer sw.js)
    await Promise.all(CORE.map(async f => {
      if (await data.match(f)) return;
      if (!f.endsWith('manifest.json')) return data.add(f);
      const r = await fetch(new Request(f, { cache: 'no-cache' }));
      if (!r.ok) throw new Error('manifest.json: ' + r.status);
      const m = await r.clone().json();
      if ('cook-data-' + m.version !== DATA) throw new Error('manifest.json is from another release: ' + m.version);
      await data.put(f, r);
    }));
    if (!self.registration.active) await self.skipWaiting();
  })());
});

// old versions go (after the install above has taken what it needs), but only ours: cook-... caches that are not the
// current shell, data or font cache
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.map(k => (k.startsWith('cook-') && k !== VERSION && k !== DATA && k !== FONTS ? caches.delete(k) : null))))
    .then(() => self.clients.claim())
));
self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

// run work after the response is sent without the worker being stopped under it
function keepAlive(e) {
  let done; const pending = [];
  e.waitUntil(new Promise(r => { done = r; }));
  return { add: p => { pending.push(Promise.resolve(p).catch(() => {})); }, finish: () => { Promise.all(pending).then(done, done); } };
}


self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (isData(url) || isFont(url)) {
    const k = keepAlive(e);
    e.respondWith((async () => {
      try {
        const cache = await caches.open(isFont(url) ? FONTS : DATA);
        // content-hashed files: a hit is always right. The manifest: the one this worker installed (see the top)
        const hit = await cache.match(req, isManifest(url) ? { ignoreSearch: true } : undefined);
        if (hit) return hit;
        const r = await fetch(req, isManifest(url) ? { cache: 'no-cache' } : undefined);   // evicted, or the first visit
        if (r.ok) k.add(cache.put(req, r.clone()));
        return r;
      } finally { k.finish(); }
    })());
    return;
  }
  // the shell from this worker's own cache only (Reader and Focus keep theirs on the same origin)
  e.respondWith(caches.open(VERSION).then(shell => shell.match(req, { ignoreSearch: req.mode === 'navigate' }).then(hit => hit || fetch(req).catch(() =>
    req.mode === 'navigate' ? shell.match('index.html') : Response.error()))));
});
