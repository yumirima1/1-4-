self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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

  const icon = payload.icon || new URL("./icon.svg", self.registration.scope).href;
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
