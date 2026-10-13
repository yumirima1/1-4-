self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open("1-4-shell-v1");
    const shellUrl = new URL("./", self.registration.scope).href;
    const response = await fetch(shellUrl);
    if (!response.ok) throw new Error(`App shell request failed: ${response.status}`);
    await cache.put(shellUrl, response);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith("1-4-shell-") && name !== "1-4-shell-v1")
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const scopeUrl = new URL(self.registration.scope);
  if (
    request.method !== "GET" ||
    new URL(request.url).origin !== scopeUrl.origin ||
    !new URL(request.url).pathname.startsWith(scopeUrl.pathname)
  ) return;

  const isNavigation = request.mode === "navigate";
  const shellUrl = new URL("./", scopeUrl).href;
  const update = caches.open("1-4-shell-v1").then(async (cache) => {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(isNavigation ? shellUrl : request, response.clone());
    }
    return response;
  });
  event.waitUntil(update.catch((error) => {
    console.warn("Offline cache refresh failed:", error);
  }));
  event.respondWith((async () => {
    const cache = await caches.open("1-4-shell-v1");
    const cached = await cache.match(isNavigation ? shellUrl : request);
    if (cached) return cached;
    return update;
  })());
});

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    const text = event.data.text();
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed;
      } else {
        payload = { body: text };
      }
    } catch {
      payload = { body: text };
    }
  }

  const icon = payload.icon || new URL("./app-icon.png", self.registration.scope).href;
  event.waitUntil(self.registration.showNotification(payload.title || "1−4 案内箱", {
    body: payload.body || "明日の時間割と提出物を確認してください。",
    icon,
    badge: icon,
    data: { url: payload.url || self.registration.scope },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const scopeUrl = new URL(self.registration.scope);
    let targetUrl;
    try {
      targetUrl = new URL(event.notification.data?.url || scopeUrl.href, scopeUrl);
      if (
        targetUrl.origin !== scopeUrl.origin ||
        !targetUrl.pathname.startsWith(scopeUrl.pathname)
      ) {
        targetUrl = scopeUrl;
      }
    } catch {
      targetUrl = scopeUrl;
    }

    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (
        new URL(client.url).origin !== scopeUrl.origin ||
        !new URL(client.url).pathname.startsWith(scopeUrl.pathname)
      ) continue;

      if (client.url !== targetUrl.href && "navigate" in client) {
        await client.navigate(targetUrl.href);
      }
      await client.focus();
      return;
    }

    await self.clients.openWindow(targetUrl.href);
  })());
});
