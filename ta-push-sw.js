/* Trade Agent Manager — уведомления на iPhone (приложение на экране «Домой», iOS 16.4+): веб-уведомления через тот же
   проект Firebase, что и у приложения Android. Сервер шлёт сообщение с данными {kind, title, body, mid, …}; здесь оно
   показывается всегда (iPhone требует показать каждое), нажатие открывает приложение на нужном экране (страница
   получает {type:'ta-push-open', data} или адрес ?push=…). Ничего не кэширует и не перехватывает загрузку страниц. */
'use strict';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var p = {};
  try { p = e.data ? e.data.json() : {}; } catch (_) { try { p = { data: { body: e.data.text() } }; } catch (__) { p = {}; } }
  var d = p.data || {}, n = p.notification || {};
  var title = String(d.title || n.title || 'Trade Agent');
  var body = String(d.body || n.body || '');
  var opts = { body: body, icon: './icon-192.png', badge: './icon-96.png', data: d, silent: d.silent === '1' };
  if (d.mid) opts.tag = 'ta-' + d.mid;
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var d = e.notification.data || {};
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if ('focus' in c) { try { c.postMessage({ type: 'ta-push-open', data: d }); } catch (_) {} return c.focus(); }
    }
    var q = encodeURIComponent(JSON.stringify({ kind: d.kind || '', id: d.id || '', cid: d.cid || '', view: d.view || '' }));
    return self.clients.openWindow('./?push=' + q);
  }));
});
