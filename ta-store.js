/* Trade Agent Manager — documents and sign-in on our own server (docs/OWN_SERVER_PHONES.md).
   Takes the place of the Firebase app / auth / firestore libraries with the same calls the page makes (firebase.initializeApp,
   auth().signInWithEmailAndPassword / onAuthStateChanged / currentUser / signOut, firestore().collection / doc / where / orderBy /
   limit / get / set / update / delete / onSnapshot / batch / runTransaction), so the rest of the page does not change. Everything
   goes to the server's phones' API (api/mgr/v1); the server checks every read and write by the same rules Firebase had.
   Notifications (FCM) are not here: the page loads Google's messaging library on its own (window.TA_FB_REAL).
   Server address: the one chosen on the sign-in screen («Сервер компании», with a confirmation), kept in localStorage
   «ta.server». IsTek (22.11.2026): no company's address is built in; with the domain of IsTek (window.TA_ESEP_DOMAIN, ONE value
   in index.html) the code of the company is enough: «alfa» → https://alfa.<domain>. A phone that was already signed in to its
   server keeps that server. 202 (security audit 11.2026, SEC-002): the address in the page link (?server=) is not taken any
   more; only https (http only for this computer — tests); the session is kept together with its server and its token is never
   sent to another address; changing the server ends the session. */
(function () {
  'use strict';
  if (window.TA_STORE) return;
  // the demo / test base (debug APK demo mode, tests/manager-smoke.mjs) is already in place: it stays the page's «firebase»
  if (window.firebase && window.firebase.__fake) return;

  var DEFAULT_SERVER = '';
  var SESSION_KEY = 'ta.mgr.session';
  var COMPANY_KEY = 'ta.company';
  var ESEP_DOMAIN = String(window.TA_ESEP_DOMAIN || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} }

  // https://host[:port]; http only for this computer itself (tests, a developer)
  var SERVER_RE = /^(https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/i;
  function cleanServer(u) { u = String(u || '').trim().replace(/\/+$/, ''); return SERVER_RE.test(u) ? u.toLowerCase() : null; }
  // «alfa» (the code of the company on the IsTek server) → https://alfa.<domain>; anything else is an address as before
  function companyServer(u) {
    var c = String(u || '').trim().toLowerCase();
    return ESEP_DOMAIN && /^[a-z][a-z0-9]{1,19}$/.test(c) ? 'https://' + c + '.' + ESEP_DOMAIN : null;
  }
  // a phone signed in before the server address stopped being built in keeps the server of its session
  (function () {
    if (cleanServer(lsGet('ta.server'))) return;
    try { var old = JSON.parse(lsGet(SESSION_KEY) || 'null'); if (old && old.token && cleanServer(old.server)) lsSet('ta.server', cleanServer(old.server)); } catch (_) {}
  })();
  function server() { return cleanServer(lsGet('ta.server')) || DEFAULT_SERVER; }
  function api(p) { return server() + '/api/mgr/v1/' + p; }

  // ------------------------------------------------------------------ errors (Firebase-like: .code, .message)
  function fail(code, message) { var e = new Error(message || code); e.code = code; e.name = 'FirebaseError'; return e; }

  var session = null;   // {uid, email, token, server}
  try { session = JSON.parse(lsGet(SESSION_KEY) || 'null'); } catch (_) { session = null; }
  // a session belongs to the server that gave it: a session of another (or unknown) server is dropped, never sent anywhere
  if (session && (!session.token || session.server !== server())) { session = null; lsSet(SESSION_KEY, null); }
  function token() { return session && session.token && session.server === server() ? session.token : null; }

  function call(path, body, opts) {
    opts = opts || {};
    if (!server()) return Promise.reject(fail('unavailable', 'Укажите сервер компании: кнопка «Сервер компании» на экране входа.'));
    var headers = { 'Content-Type': 'application/json' };
    var t = opts.session === null ? null : token();
    if (t) headers['X-TA-Session'] = t;
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, opts.timeout || 20000) : null;
    return fetch(api(path), { method: 'POST', headers: headers, body: JSON.stringify(body || {}), signal: ctl ? ctl.signal : undefined, cache: 'no-store' })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : {}; } catch (_) { j = {}; }
          if (r.status === 401 && t) expired();
          if (!r.ok) { var er = fail((j && j.code) || (r.status === 403 ? 'permission-denied' : r.status === 404 ? 'not-found' : r.status === 401 ? 'unauthenticated' : 'unavailable'), (j && j.message) || ('HTTP ' + r.status)); er.data = j; throw er; }
          return j;
        });
      }, function (e) {
        throw fail('unavailable', 'Нет связи с сервером' + (e && e.name === 'AbortError' ? ' (не ответил вовремя)' : ''));
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  // ------------------------------------------------------------------ values: JS ↔ Firestore encoding
  function Timestamp(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds || 0; }
  Timestamp.prototype.toMillis = function () { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); };
  Timestamp.prototype.toDate = function () { return new Date(this.toMillis()); };
  Timestamp.prototype.valueOf = function () { return this.toMillis(); };
  Timestamp.prototype.isEqual = function (o) { return o instanceof Timestamp && o.seconds === this.seconds && o.nanoseconds === this.nanoseconds; };
  Timestamp.now = function () { return Timestamp.fromMillis(Date.now()); };
  Timestamp.fromMillis = function (ms) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); };
  Timestamp.fromDate = function (d) { return Timestamp.fromMillis(d.getTime()); };

  var SERVER_TS = { __ta: 'serverTimestamp' };
  var DELETE_FIELD = { __ta: 'delete' };

  function enc(v) {
    if (v === null) return { nullValue: null };
    if (v === SERVER_TS) return { timestampValue: new Date().toISOString() };
    switch (typeof v) {
      case 'boolean': return { booleanValue: v };
      case 'number':
        if (Number.isInteger(v) && Math.abs(v) <= 9007199254740991) return { integerValue: String(v) };
        return { doubleValue: isFinite(v) ? v : (isNaN(v) ? 'NaN' : (v > 0 ? 'Infinity' : '-Infinity')) };
      case 'string': return { stringValue: v };
      case 'object':
        if (v instanceof Date) return { timestampValue: v.toISOString() };
        if (v instanceof Timestamp) return { timestampValue: v.toDate().toISOString() };
        if (Array.isArray(v)) return { arrayValue: { values: v.filter(function (x) { return x !== undefined; }).map(enc) } };
        return { mapValue: { fields: encFields(v) } };
      default: return { nullValue: null };
    }
  }
  function encFields(o) {
    var f = {};
    Object.keys(o || {}).forEach(function (k) { var v = o[k]; if (v !== undefined && v !== DELETE_FIELD) f[k] = enc(v); });
    return f;
  }
  function dec(v) {
    if (!v || typeof v !== 'object') return null;
    if ('nullValue' in v) return null;
    if ('booleanValue' in v) return !!v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return typeof v.doubleValue === 'number' ? v.doubleValue : Number(v.doubleValue);
    if ('stringValue' in v) return v.stringValue;
    if ('timestampValue' in v) return Timestamp.fromMillis(Date.parse(v.timestampValue));
    if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(dec);
    if ('mapValue' in v) return decFields((v.mapValue && v.mapValue.fields) || {});
    if ('referenceValue' in v) return v.referenceValue;
    return null;
  }
  function decFields(f) { var o = {}; Object.keys(f || {}).forEach(function (k) { o[k] = dec(f[k]); }); return o; }

  function quoteKey(k) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : '`' + String(k).replace(/`/g, '') + '`'; }
  function isPlain(v) { return v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Timestamp) && v !== SERVER_TS && v !== DELETE_FIELD; }
  // set(…, {merge: true}): every leaf of the data (maps merge deeply, as in Firestore)
  function leafMask(o, prefix, out) {
    Object.keys(o).forEach(function (k) {
      var v = o[k]; if (v === undefined) return;
      var p = prefix ? prefix + '.' + quoteKey(k) : quoteKey(k);
      if (isPlain(v) && Object.keys(v).length) leafMask(v, p, out); else out.push(p);
    });
    return out;
  }
  // update({'a.b': 1, c: {…}}): dotted keys are paths, values replace whole fields
  function updateWrite(data) {
    var fields = {}, mask = [];
    Object.keys(data).forEach(function (k) {
      var v = data[k]; if (v === undefined) return;
      var parts = String(k).split('.');
      var node = fields;
      for (var i = 0; i < parts.length - 1; i++) {
        node[parts[i]] = node[parts[i]] || { mapValue: { fields: {} } };
        node = node[parts[i]].mapValue.fields;
      }
      if (v !== DELETE_FIELD) node[parts[parts.length - 1]] = enc(v);
      mask.push(parts.map(quoteKey).join('.'));
    });
    return { fields: fields, mask: mask };
  }

  // ------------------------------------------------------------------ snapshots
  function DocumentSnapshot(ref, raw) {
    this.ref = ref; this.id = ref.id;
    this.exists = !!(raw && raw.exists);
    this._data = this.exists ? decFields(raw.fields || {}) : undefined;
    this._updateTime = raw && raw.updateTime || null;
    this.metadata = { fromCache: false, hasPendingWrites: false };
  }
  DocumentSnapshot.prototype.data = function () { return this._data === undefined ? undefined : JSON.parse(JSON.stringify(this._data, tsReplacer), tsReviver); };
  DocumentSnapshot.prototype.get = function (field) {
    var v = this._data; String(field).split('.').forEach(function (p) { v = v == null ? undefined : v[p]; }); return v;
  };
  function tsReplacer(k, v) { return v instanceof Timestamp ? { __ts: v.toMillis() } : v; }
  function tsReviver(k, v) { return v && typeof v === 'object' && '__ts' in v && Object.keys(v).length === 1 ? Timestamp.fromMillis(v.__ts) : v; }

  function QuerySnapshot(query, docs, previous) {
    var self = this;
    this.query = query;
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
    this.metadata = { fromCache: false, hasPendingWrites: false };
    this._previous = previous || [];
    this.forEach = function (cb, thisArg) { docs.forEach(cb, thisArg); };
    this.docChanges = function () {
      var before = {}; self._previous.forEach(function (d, i) { before[d.ref.path] = { d: d, i: i }; });
      var out = [];
      docs.forEach(function (d, i) {
        var b = before[d.ref.path];
        if (!b) out.push({ type: 'added', doc: d, oldIndex: -1, newIndex: i });
        else if (b.d._updateTime !== d._updateTime) out.push({ type: 'modified', doc: d, oldIndex: b.i, newIndex: i });
        delete before[d.ref.path];
      });
      Object.keys(before).forEach(function (p) { out.push({ type: 'removed', doc: before[p].d, oldIndex: before[p].i, newIndex: -1 }); });
      return out;
    };
  }

  // ------------------------------------------------------------------ references
  function trimPath(p) { return String(p || '').replace(/^\/+|\/+$/g, ''); }
  function newId() {
    var a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', s = '', b = new Uint8Array(20);
    try { crypto.getRandomValues(b); } catch (_) { for (var i = 0; i < 20; i++) b[i] = Math.random() * 256 | 0; }
    for (var j = 0; j < 20; j++) s += a[b[j] % a.length];
    return s;
  }

  function DocumentReference(db, path) {
    this.firestore = db; this.path = trimPath(path);
    var parts = this.path.split('/');
    this.id = parts[parts.length - 1];
    this.parent = new CollectionReference(db, parts.slice(0, -1).join('/'));
  }
  DocumentReference.prototype.collection = function (sub) { return new CollectionReference(this.firestore, this.path + '/' + trimPath(sub)); };
  DocumentReference.prototype.isEqual = function (o) { return o && o.path === this.path; };
  DocumentReference.prototype.get = function () {
    var ref = this;
    return call('docs/get', { paths: [ref.path] }).then(function (j) {
      var raw = (j.docs || [])[0] || {};
      if (raw.denied) throw fail('permission-denied', 'Missing or insufficient permissions.');
      cacheDoc(ref.path, raw);
      return new DocumentSnapshot(ref, raw);
    }, function (e) {
      if (e.code === 'unavailable' && docCache[ref.path]) { var s = new DocumentSnapshot(ref, docCache[ref.path]); s.metadata.fromCache = true; return s; }
      throw e;
    });
  };
  DocumentReference.prototype.set = function (data, options) { return this.firestore.batch().set(this, data, options).commit(); };
  DocumentReference.prototype.update = function (a, b) {
    var data = a; if (typeof a === 'string') { data = {}; for (var i = 0; i < arguments.length; i += 2) data[arguments[i]] = arguments[i + 1]; }
    return this.firestore.batch().update(this, data).commit();
  };
  DocumentReference.prototype.delete = function () { return this.firestore.batch().delete(this).commit(); };
  DocumentReference.prototype.onSnapshot = function (a, b, c) {
    var ref = this, o = observer(a, b, c);
    return listen({ doc: ref.path }, function (msg) {
      if (msg.error) { o.error(fail(msg.error, msg.error === 'permission-denied' ? 'Missing or insufficient permissions.' : msg.error)); return false; }
      cacheDoc(ref.path, msg.doc);
      o.next(new DocumentSnapshot(ref, msg.doc));
      return true;
    }, function () {
      if (docCache[ref.path]) { var s = new DocumentSnapshot(ref, docCache[ref.path]); s.metadata.fromCache = true; o.next(s); }
    });
  };

  function Query(db, path, where, order, lim) {
    this.firestore = db; this.path = trimPath(path);
    this._where = where || []; this._order = order || []; this._limit = lim || null;
  }
  Query.prototype.where = function (field, op, value) {
    return new Query(this.firestore, this.path, this._where.concat([{ field: String(field), op: op, value: enc(value) }]), this._order, this._limit);
  };
  Query.prototype.orderBy = function (field, dir) {
    return new Query(this.firestore, this.path, this._where, this._order.concat([{ field: String(field), dir: dir === 'desc' ? 'desc' : 'asc' }]), this._limit);
  };
  Query.prototype.limit = function (n) { return new Query(this.firestore, this.path, this._where, this._order, n); };
  Query.prototype._body = function () { var b = { parent: this.path, where: this._where, orderBy: this._order }; if (this._limit) b.limit = this._limit; return b; };
  Query.prototype._key = function () { return JSON.stringify(this._body()); };
  Query.prototype._snap = function (list, previous) {
    var db = this.firestore;
    return new QuerySnapshot(this, (list || []).map(function (raw) { return new DocumentSnapshot(new DocumentReference(db, raw.path), raw); }), previous);
  };
  // the server answers at most 500 documents at a time and says where to continue («next»)
  function queryAll(body) {
    var all = [], want = body.limit || Infinity;
    function page(after, n) {
      var b = Object.assign({}, body); if (after) b.after = after;
      return call('docs/query', b).then(function (j) {
        all = all.concat(j.docs || []);
        if (j.next && all.length < want && n < 40) return page(j.next, n + 1);
        return { docs: all.length > want ? all.slice(0, want) : all };
      });
    }
    return page(null, 0);
  }
  Query.prototype.get = function () {
    var q = this;
    return queryAll(q._body()).then(function (j) { queryCache[q._key()] = j.docs || []; return q._snap(j.docs); }, function (e) {
      if (e.code === 'unavailable' && queryCache[q._key()]) { var s = q._snap(queryCache[q._key()]); s.metadata.fromCache = true; return s; }
      throw e;
    });
  };
  Query.prototype.onSnapshot = function (a, b, c) {
    var q = this, o = observer(a, b, c), prev = [];
    return listen({ q: q._body() }, function (msg) {
      if (msg.error) { o.error(fail(msg.error, msg.error === 'permission-denied' ? 'Missing or insufficient permissions.' : msg.error)); return false; }
      queryCache[q._key()] = msg.docs || [];
      var s = q._snap(msg.docs, prev); prev = s.docs;
      o.next(s);
      return true;
    }, function () {
      if (queryCache[q._key()]) { var s = q._snap(queryCache[q._key()], prev); s.metadata.fromCache = true; prev = s.docs; o.next(s); }
    });
  };

  function CollectionReference(db, path) {
    Query.call(this, db, path);
    var parts = this.path.split('/');
    this.id = parts[parts.length - 1];
  }
  CollectionReference.prototype = Object.create(Query.prototype);
  CollectionReference.prototype.constructor = CollectionReference;
  CollectionReference.prototype.doc = function (id) { return new DocumentReference(this.firestore, this.path + '/' + (id ? trimPath(id) : newId())); };
  CollectionReference.prototype.add = function (data) { var ref = this.doc(); return ref.set(data).then(function () { return ref; }); };

  function observer(a, b, c) {
    if (a && typeof a === 'object' && (a.next || a.error)) return { next: a.next || function () {}, error: a.error || function () {} };
    if (typeof a === 'object' && typeof b === 'function') return { next: b, error: c || function () {} };   // (options, next, error)
    return { next: a || function () {}, error: b || function (e) { try { console.warn('ta-store listen', e); } catch (_) {} } };
  }

  // ------------------------------------------------------------------ live updates: ONE stream for the whole page
  // Every onSnapshot is a target of the same POST listen stream (the server sends «data: {id, doc|docs|error}»); adding or removing
  // one reopens the stream with the new list (30 ms later, so a burst of listeners is one request). The browser allows only a few
  // connections per server — one stream keeps all of them free for reads and writes.
  var docCache = {}, queryCache = {};
  function cacheDoc(path, raw) { if (raw) docCache[path] = raw; }

  // the server takes at most 20 targets per stream: more targets → several streams (each its own connection)
  var MAX_TARGETS = 20;
  var hub = { targets: {}, seq: 0, ctls: [], timer: null, failures: 0, gen: 0 };
  function listen(target, onMessage, onOffline) {
    var id = 't' + (++hub.seq);
    hub.targets[id] = { t: target, on: onMessage, off: onOffline, last: null, got: false };
    restart(30);
    return function stop() { if (hub.targets[id]) { delete hub.targets[id]; restart(30); } };
  }
  function restart(ms) { clearTimeout(hub.timer); hub.timer = setTimeout(connect, ms); }
  function reopenAll() { hub.failures = 0; Object.keys(hub.targets).forEach(function (k) { hub.targets[k].last = null; }); restart(30); }
  function connect() {
    hub.ctls.forEach(function (c) { try { c.abort(); } catch (_) {} });
    hub.ctls = [];
    var gen = ++hub.gen;
    var ids = Object.keys(hub.targets);
    var t = token();
    if (!ids.length || !t) return;   // no session: nothing to listen to (the server would answer 401)
    var chunks = [];
    for (var i = 0; i < ids.length; i += MAX_TARGETS) chunks.push(ids.slice(i, i + MAX_TARGETS));
    var ended = false;
    function again(ms) { if (!ended && gen === hub.gen) { ended = true; restart(ms); } }
    chunks.forEach(function (part) {
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      if (ctl) hub.ctls.push(ctl);
      var headers = { 'Content-Type': 'application/json', 'X-TA-Session': t };
      var body = JSON.stringify({ targets: part.map(function (id) { var x = hub.targets[id].t; return x.doc ? { id: id, doc: x.doc } : { id: id, q: x.q }; }) });
      fetch(api('listen'), { method: 'POST', headers: headers, body: body, signal: ctl ? ctl.signal : undefined, cache: 'no-store' })
        .then(function (r) {
          if (r.status === 401) { expired(); throw fail('unauthenticated', 'HTTP 401'); }
          if (!r.ok || !r.body || !r.body.getReader) throw fail('unavailable', 'HTTP ' + r.status);
          hub.failures = 0;
          return read(r.body.getReader());
        })
        .then(function () { again(500); })   // the server ends a stream after 25 min
        .catch(function (e) {
          if ((ctl && ctl.signal.aborted) || gen !== hub.gen) return;
          if (e && e.code === 'unauthenticated') return;
          part.forEach(function (k) { var x = hub.targets[k]; if (x && !x.got && x.off) { x.got = true; try { x.off(); } catch (_) {} } });
          hub.failures++;
          again(Math.min(30000, 1000 * Math.pow(2, Math.min(hub.failures, 5))) + (navigator.onLine === false ? 4000 : 0));
        });
    });
  }
  function read(reader) {
    var dec = new TextDecoder(), buf = '';
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        buf += dec.decode(r.value, { stream: true });
        var i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          var chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          chunk.split('\n').forEach(function (line) {
            if (line.indexOf('data: ') !== 0) return;
            var msg; try { msg = JSON.parse(line.slice(6)); } catch (_) { return; }
            if (msg.error === 'unauthenticated') { expired(); return; }
            var x = hub.targets[msg.id]; if (!x) return;
            var sig = line; if (x.last === sig) return;
            x.last = sig; x.got = true;
            var keep = true; try { keep = x.on(msg) !== false; } catch (e) { try { console.warn('ta-store listener', e); } catch (_) {} }
            if (!keep) delete hub.targets[msg.id];
          });
        }
        return pump();
      });
    }
    return pump();
  }
  window.addEventListener('online', reopenAll);

  // ------------------------------------------------------------------ writes: batch, transaction
  function WriteBatch(db) { this.firestore = db; this._writes = []; this._done = false; }
  WriteBatch.prototype.set = function (ref, data, options) {
    var w = { path: ref.path, op: 'set' };
    if (options && (options.merge || options.mergeFields)) {
      var mask = options.mergeFields ? options.mergeFields.map(String) : leafMask(data || {}, '', []);
      var fields = encFields(data || {});
      // FieldValue.delete() inside a merge: in the mask, not in the fields
      Object.keys(data || {}).forEach(function (k) { if (data[k] === DELETE_FIELD && mask.indexOf(quoteKey(k)) < 0) mask.push(quoteKey(k)); });
      w.fields = fields; w.mask = mask;
    } else {
      w.fields = encFields(data || {});
    }
    this._writes.push(w); return this;
  };
  WriteBatch.prototype.update = function (ref, a, b) {
    var data = a; if (typeof a === 'string') { data = {}; for (var i = 1; i < arguments.length; i += 2) data[arguments[i]] = arguments[i + 1]; }
    var u = updateWrite(data || {});
    this._writes.push({ path: ref.path, op: 'update', fields: u.fields, mask: u.mask }); return this;
  };
  WriteBatch.prototype.delete = function (ref) { this._writes.push({ path: ref.path, op: 'delete' }); return this; };
  WriteBatch.prototype.commit = function () {
    if (this._done) return Promise.reject(fail('failed-precondition', 'A write batch can no longer be used after commit() has been called.'));
    this._done = true;
    if (!this._writes.length) return Promise.resolve();
    var writes = this._writes;
    return commitWhenOnline(writes).then(function () {
      writes.forEach(function (w) { if (w.op === 'delete') delete docCache[w.path]; });
    });
  };

  // Like Firestore: a write made without connection is not an error — it waits and goes when the connection is back (the
  // phone code relies on this: «Заявка сохранена на телефоне — уйдёт оператору, когда появится связь»). Only «no connection»
  // waits; a refusal of the server (rules, wrong data) fails at once.
  function commitWhenOnline(writes) {
    var attempt = 0;
    function once() {
      return call('docs/commit', { writes: writes }, { timeout: 30000 }).catch(function (e) {
        if (!e || e.code !== 'unavailable') throw e;
        attempt++;
        return new Promise(function (resolve) {
          var done = false;
          function go() { if (done) return; done = true; window.removeEventListener('online', go); clearTimeout(t); resolve(); }
          window.addEventListener('online', go);
          var t = setTimeout(go, navigator.onLine === false ? 60000 : Math.min(30000, 1000 * Math.pow(2, Math.min(attempt, 5))));
        }).then(once);
      });
    }
    return once();
  }

  function Transaction(db) { this.firestore = db; this._batch = new WriteBatch(db); this._read = {}; }
  Transaction.prototype.get = function (ref) {
    var t = this;
    return call('docs/get', { paths: [ref.path] }).then(function (j) {
      var raw = (j.docs || [])[0] || {};
      if (raw.denied) throw fail('permission-denied', 'Missing or insufficient permissions.');
      t._read[ref.path] = raw.exists ? { updateTime: raw.updateTime } : { exists: false };
      return new DocumentSnapshot(ref, raw);
    });
  };
  Transaction.prototype.set = function (ref, data, options) { this._batch.set(ref, data, options); return this; };
  Transaction.prototype.update = function () { this._batch.update.apply(this._batch, arguments); return this; };
  Transaction.prototype.delete = function (ref) { this._batch.delete(ref); return this; };
  Transaction.prototype._commit = function () {
    var read = this._read;
    var writes = this._batch._writes.map(function (w) {
      var r = read[w.path], x = Object.assign({}, w);
      if (r && r.updateTime) x.updateTime = r.updateTime;
      else if (r && r.exists === false && w.op !== 'update') x.exists = false;
      return x;
    });
    if (!writes.length) return Promise.resolve();
    return call('docs/commit', { writes: writes }, { timeout: 30000 });
  };

  // ------------------------------------------------------------------ Firestore
  function Firestore(app) { this.app = app; }
  Firestore.prototype.collection = function (p) { return new CollectionReference(this, p); };
  Firestore.prototype.doc = function (p) { return new DocumentReference(this, p); };
  Firestore.prototype.batch = function () { return new WriteBatch(this); };
  Firestore.prototype.runTransaction = function (fn) {
    var db = this, attempt = 0;
    function run() {
      var t = new Transaction(db);
      return Promise.resolve(fn(t)).then(function (result) {
        return t._commit().then(function () { return result; });
      }).catch(function (e) {
        if (e && (e.code === 'aborted' || e.code === 'not-found') && ++attempt < 5) return new Promise(function (r) { setTimeout(r, 120 * attempt); }).then(run);
        throw e;
      });
    }
    return run();
  };
  Firestore.prototype.enablePersistence = function () { return Promise.resolve(); };
  Firestore.prototype.settings = function () {};
  Firestore.prototype.enableNetwork = function () { reopenAll(); return Promise.resolve(); };
  Firestore.prototype.disableNetwork = function () { return Promise.resolve(); };
  Firestore.prototype.waitForPendingWrites = function () { return Promise.resolve(); };
  Firestore.prototype.terminate = function () { return Promise.resolve(); };
  Firestore.prototype.clearPersistence = function () { return Promise.resolve(); };

  // ------------------------------------------------------------------ Auth
  function User(s, auth) {
    this.uid = s.uid; this.email = s.email || null; this.displayName = null; this.isAnonymous = false;
    this._auth = auth;
  }
  User.prototype.getIdToken = function () { return Promise.resolve(token() || ''); };
  // the current code is checked by the server together with the new one (auth/password): here it is only kept
  User.prototype.reauthenticateWithCredential = function (cred) {
    this._old = code(cred && cred.password); return Promise.resolve({ user: this });
  };
  User.prototype.updatePassword = function (p) {
    var u = this;
    if (!u._old) return Promise.reject(fail('auth/requires-recent-login', 'Введите текущий код ещё раз.'));
    p = code(p);
    if (p.length < 8) return Promise.reject(fail('auth/weak-password', 'Новый код — от 8 символов: буквы и цифры.'));
    return call('auth/password', { old: u._old, password: p }).then(function (j) {
      u._old = null;
      if (j && j.token) setSession(j);   // the new code ended every earlier session: this phone gets the new one
    }, function (e) { u._old = null; if (e.code === 'auth/wrong-password') throw fail('auth/wrong-password', 'Неверный текущий код.'); throw e; });
  };
  function code(p) { return String(p == null ? '' : p).replace(/\s+/g, ''); }

  function Auth(app) {
    this.app = app; this._main = app.name === '[DEFAULT]'; this._observers = [];
    this.currentUser = this._main && session ? new User(session, this) : null;
    var self = this;
    if (this._main) mainAuth = this;
    if (this._main && session) {
      // the session is checked with the server once at start; a sign-in switched off / expired / a new code → signed out
      call('auth/refresh', {}).then(function (j) { setSession(j); }, function (e) {
        if (e.code !== 'unavailable') { setSession(null); self.currentUser = null; self._emit(); }
      });
    }
  }
  Auth.prototype._emit = function () {
    var u = this.currentUser;
    this._observers.slice().forEach(function (o) { try { o(u); } catch (e) { try { console.warn(e); } catch (_) {} } });
  };
  Auth.prototype.onAuthStateChanged = function (next) {
    var self = this, fn = typeof next === 'function' ? next : (next && next.next) || function () {};
    this._observers.push(fn);
    setTimeout(function () { try { fn(self.currentUser); } catch (_) {} }, 0);
    return function () { self._observers = self._observers.filter(function (x) { return x !== fn; }); };
  };
  // ------------------------------------------------------------------ 209: second step of the sign-in (leaders, accounting)
  // The server asks 6 digits of an authenticator after the right login code (auth/second-step-required with a 5-minute ticket); the
  // layer below shows its own window over the page, sends the code (auth/second-step) and keeps «Этот телефон мой» (the trust key:
  // the next sign-ins of this phone are not asked for 30 days). The page itself (index.html) does not change.
  function trustKey(login) { return 'ta.mgr.trust.' + server() + '.' + String(login || '').toLowerCase(); }
  function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
  function secondStep(login, challenge) {
    return new Promise(function (resolve, reject) {
      var ticket = challenge.ticket;
      var wrap = el('div', 'position:fixed;inset:0;z-index:2147483000;background:rgba(10,14,13,.72);display:flex;align-items:center;justify-content:center;padding:16px');
      wrap.setAttribute('role', 'dialog'); wrap.id = 'ta-second-step';
      var card = el('div', 'width:100%;max-width:420px;background:var(--card,#272F2F);color:var(--ink,#F1EFE8);border:1px solid var(--line,#323E3E);border-radius:14px;padding:22px 18px;font-family:var(--sans,sans-serif);box-shadow:0 24px 48px -28px rgba(0,0,0,.95)');
      card.appendChild(el('div', 'font-size:18px;font-weight:650;margin-bottom:6px', 'Второй шаг входа'));
      card.appendChild(el('div', 'font-size:14px;color:var(--ink2,#C8D0CC);margin-bottom:12px', challenge.text || 'Введите 6 цифр из приложения-аутентификатора.'));
      if (challenge.setup && challenge.secret) {
        card.appendChild(el('div', 'font-size:13px;color:var(--mut,#98A69F)', 'Ключ для приложения-аутентификатора:'));
        var key = el('div', 'font-family:var(--mono,monospace);font-size:16px;letter-spacing:.08em;word-break:break-all;padding:10px;margin:6px 0 4px;border-radius:10px;background:var(--bg2,#202828);user-select:all', String(challenge.secret).replace(/(.{4})/g, '$1 ').trim());
        card.appendChild(key);
        if (challenge.uri) {
          var link = el('a', 'display:inline-block;font-size:14px;color:var(--acc,#76A38C);margin:4px 0 12px', 'Открыть в приложении-аутентификаторе');
          link.href = challenge.uri; card.appendChild(link);
        }
      }
      var input = el('input', 'width:100%;font-size:24px;letter-spacing:.3em;text-align:center;padding:12px;border-radius:10px;border:1px solid var(--line,#323E3E);background:var(--bg2,#202828);color:var(--ink,#F1EFE8);margin:6px 0 10px');
      input.inputMode = 'numeric'; input.autocomplete = 'one-time-code'; input.maxLength = 8; input.placeholder = '000000';
      card.appendChild(input);
      var row = el('label', 'display:flex;gap:10px;align-items:center;font-size:14px;margin-bottom:12px');
      var trust = el('input'); trust.type = 'checkbox'; trust.checked = true; trust.style.cssText = 'width:20px;height:20px;accent-color:var(--acc,#76A38C)';
      row.appendChild(trust); row.appendChild(el('span', '', 'Этот телефон мой — не спрашивать код 30 дней'));
      card.appendChild(row);
      var msg = el('div', 'font-size:13.5px;color:var(--red,#E68B70);min-height:18px;margin-bottom:10px', '');
      card.appendChild(msg);
      var ok = el('button', 'display:block;width:100%;padding:13px;border-radius:10px;border:0;background:var(--acc,#76A38C);color:var(--acc-t,#141C18);font-size:15px;font-weight:650;margin-bottom:8px', 'Подтвердить и войти');
      var cancel = el('button', 'display:block;width:100%;padding:12px;border-radius:10px;border:1px solid var(--line,#323E3E);background:transparent;color:var(--ink2,#C8D0CC);font-size:14px', 'Отмена');
      card.appendChild(ok); card.appendChild(cancel);
      wrap.appendChild(card);
      document.body.appendChild(wrap);
      setTimeout(function () { try { input.focus(); } catch (_) {} }, 50);
      function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
      var busy = false;
      function send() {
        if (busy) return;
        var digits = String(input.value || '').replace(/\D/g, '');
        if (digits.length !== 6) { msg.textContent = 'Введите 6 цифр.'; return; }
        busy = true; ok.disabled = true; msg.textContent = '';
        call('auth/second-step', { ticket: ticket, code: digits, trust: !!trust.checked, device: (navigator.userAgent || '').slice(0, 80) }, { session: null })
          .then(function (j) {
            if (j && j.trust) lsSet(trustKey(login), j.trust);
            close(); resolve(j);
          }, function (e) {
            busy = false; ok.disabled = false;
            if (e.code === 'auth/second-step-expired') { close(); reject(e); return; }
            msg.textContent = e.message || 'Код не подошёл.'; input.value = ''; try { input.focus(); } catch (_) {}
          });
      }
      ok.addEventListener('click', send);
      input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') send(); });
      cancel.addEventListener('click', function () { close(); reject(fail('auth/second-step-cancelled', 'Вход отменён.')); });
    });
  }

  // 202: the phone signs in with its login (no list of logins before the sign-in); an alias e-mail still works
  Auth.prototype.signInWithEmailAndPassword = function (email, password) {
    var self = this, login = String(email || '').trim();
    var body = login.indexOf('@') >= 0 ? { email: login } : { login: login };
    body.password = code(password);
    var trusted = lsGet(trustKey(login));
    if (trusted) body.trust = trusted;
    return call('auth/signin', body, { session: null }).catch(function (e) {
      // 209: a leader / accountant — the second step (once per phone)
      if (e && e.code === 'auth/second-step-required' && e.data && e.data.ticket) {
        if (trusted) lsSet(trustKey(login), null);
        return secondStep(login, e.data);
      }
      throw e;
    }).then(function (j) {
      if (self._main && login.indexOf('@') < 0) lsSet('ta.mgr.login', login);
      if (self._main) { setSession(j); self.currentUser = new User(session, self); reopenAll(); self._emit(); return { user: self.currentUser }; }
      self.currentUser = new User(j, self); return { user: self.currentUser };
    });
  };
  Auth.prototype.createUserWithEmailAndPassword = function (email, password) {
    // the administrator makes a sign-in for an employee (the page's second app «TradeAgentAliasCreator»): with his own session
    var self = this;
    return call('auth/create', { email: String(email || ''), password: String(password || ''), displayName: '' }).then(function (j) {
      var u = new User({ uid: j.uid, email: email }, self);
      if (!self._main) self.currentUser = u;
      return { user: u };
    });
  };
  Auth.prototype.signOut = function () {
    if (this._main) {
      // the server ends the session (no copy of the token stays valid); the phone forgets it at once, even offline
      if (token()) call('auth/signout', {}, { timeout: 8000 }).catch(function () {});
      setSession(null); this.currentUser = null; reopenAll(); this._emit();
    } else this.currentUser = null;
    return Promise.resolve();
  };
  Auth.prototype.sendPasswordResetEmail = function () {
    return Promise.reject(fail('auth/operation-not-allowed', 'Новый код выдаёт администратор в программе на компьютере: «Сотрудники» → карточка → «Новый код».'));
  };
  Auth.prototype.setPersistence = function () { return Promise.resolve(); };

  function setSession(j) {
    session = j && j.token ? { uid: j.uid, email: j.email, token: j.token, server: server() } : null;
    lsSet(SESSION_KEY, session ? JSON.stringify(session) : null);
    // the name of the company comes from its server (the heading of the phone's PDF documents)
    if (j && j.token && typeof j.company === 'string' && j.company.trim()) lsSet(COMPANY_KEY, j.company.trim().slice(0, 200));
  }

  // the server said «sign in again» (a new code, sign-out on another phone, switched off, 90 days): the page goes to the sign-in
  var mainAuth = null;
  function expired() {
    if (!session) return;
    setSession(null);
    if (mainAuth) { mainAuth.currentUser = null; mainAuth._emit(); }
  }

  /* «Сервер компании» (sign-in screen, with a confirmation): only https (http only for this computer); the session of the old
     server is ended and forgotten — its token never goes to the new address. Returns false for a wrong address. */
  function setServer(u) {
    var v = companyServer(u) || cleanServer(u);
    if (!v) return false;
    if (v === server()) return true;
    if (token()) call('auth/signout', {}, { timeout: 5000 }).catch(function () {});
    session = null; lsSet(SESSION_KEY, null);
    docCache = {}; queryCache = {};
    lsSet(COMPANY_KEY, null);
    lsSet('ta.server', v === DEFAULT_SERVER ? null : v);
    return true;
  }

  // ------------------------------------------------------------------ the firebase namespace
  var apps = [];
  function App(options, name) { this.options = options || {}; this.name = name || '[DEFAULT]'; this._auth = null; this._db = null; }
  App.prototype.auth = function () { return this._auth || (this._auth = new Auth(this)); };
  App.prototype.firestore = function () { return this._db || (this._db = new Firestore(this)); };
  App.prototype.delete = function () { var a = this; apps = apps.filter(function (x) { return x !== a; }); ns.apps = apps; return Promise.resolve(); };

  var real = window.firebase;   // Google's library, if it was loaded first: notifications only (window.TA_FB_REAL)
  var ns = {
    SDK_VERSION: 'ta-store-1',
    apps: apps,
    initializeApp: function (options, name) {
      var n = name || '[DEFAULT]';
      if (apps.some(function (a) { return a.name === n; })) throw fail('app/duplicate-app', 'Firebase App named \'' + n + '\' already exists');
      var a = new App(options, n); apps.push(a); ns.apps = apps; return a;
    },
    app: function (name) {
      var n = name || '[DEFAULT]', a = apps.filter(function (x) { return x.name === n; })[0];
      if (!a) throw fail('app/no-app', 'No Firebase App \'' + n + '\' has been created');
      return a;
    },
    auth: function (app) { return (app || ns.app()).auth(); },
    firestore: function (app) { return (app || ns.app()).firestore(); },
    messaging: function () {
      var r = window.TA_FB_REAL;
      if (!r || !r.messaging) throw fail('messaging/unsupported', 'messaging is not loaded');
      return r.messaging();
    }
  };
  ns.auth.EmailAuthProvider = { credential: function (email, password) { return { email: email, password: password, providerId: 'password' }; } };
  ns.firestore.FieldValue = {
    serverTimestamp: function () { return SERVER_TS; },
    delete: function () { return DELETE_FIELD; }
  };
  ns.firestore.Timestamp = Timestamp;
  ns.firestore.FieldPath = { documentId: function () { return '__name__'; } };

  if (real && real.initializeApp && !real.__taStore) window.TA_FB_REAL = real;
  ns.__taStore = true;
  window.firebase = ns;
  window.TA_STORE = { server: server, defaultServer: DEFAULT_SERVER, validServer: function (u) { return companyServer(u) || cleanServer(u); },
    setServer: setServer, esepDomain: ESEP_DOMAIN, company: function () { return lsGet(COMPANY_KEY) || ''; },
    session: function () { return token() ? session : null; }, lastLogin: function () { return lsGet('ta.mgr.login') || ''; },
    targets: function () { return Object.keys(hub.targets).map(function (k) { var x = hub.targets[k]; return (x.t.doc || ('q:' + x.t.q.parent)) + (x.got ? ' ✓' : ' …'); }); } };
})();
