/* Trade Agent Manager — documents and sign-in on our own server (docs/OWN_SERVER_PHONES.md).
   Takes the place of the Firebase app / auth / firestore libraries with the same calls the page makes (firebase.initializeApp,
   auth().signInWithEmailAndPassword / onAuthStateChanged / currentUser / signOut, firestore().collection / doc / where / orderBy /
   limit / get / set / update / delete / onSnapshot / batch / runTransaction), so the rest of the page does not change. Everything
   goes to the server's phones' API (api/mgr/v1); the server checks every read and write by the same rules Firebase had.
   Notifications (FCM) are not here: the page loads Google's messaging library on its own (window.TA_FB_REAL).
   Server address: https://agent.italcolours.kz, or ?server=… once (remembered), or localStorage «ta.server». */
(function () {
  'use strict';
  if (window.TA_STORE) return;

  var DEFAULT_SERVER = 'https://agent.italcolours.kz';
  var SESSION_KEY = 'ta.mgr.session';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} }

  (function serverFromUrl() {
    try {
      var m = /[?&]server=([^&#]+)/.exec(location.search);
      if (m) {
        var u = decodeURIComponent(m[1]).replace(/\/+$/, '');
        if (/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(u)) lsSet('ta.server', u);
      }
    } catch (_) {}
  })();
  function server() { return (lsGet('ta.server') || DEFAULT_SERVER).replace(/\/+$/, ''); }
  function api(p) { return server() + '/api/mgr/v1/' + p; }

  // ------------------------------------------------------------------ errors (Firebase-like: .code, .message)
  function fail(code, message) { var e = new Error(message || code); e.code = code; e.name = 'FirebaseError'; return e; }

  var session = null;   // {uid, email, token}
  try { session = JSON.parse(lsGet(SESSION_KEY) || 'null'); } catch (_) { session = null; }

  function call(path, body, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    var s = opts.session === undefined ? session : opts.session;
    if (s && s.token) headers['X-TA-Session'] = s.token;
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, opts.timeout || 20000) : null;
    return fetch(api(path), { method: 'POST', headers: headers, body: JSON.stringify(body || {}), signal: ctl ? ctl.signal : undefined, cache: 'no-store' })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : {}; } catch (_) { j = {}; }
          if (!r.ok) throw fail((j && j.code) || (r.status === 403 ? 'permission-denied' : r.status === 404 ? 'not-found' : 'unavailable'), (j && j.message) || ('HTTP ' + r.status));
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
  Query.prototype.get = function () {
    var q = this;
    return call('docs/query', q._body()).then(function (j) { queryCache[q._key()] = j.docs || []; return q._snap(j.docs); }, function (e) {
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

  var hub = { targets: {}, seq: 0, ctl: null, timer: null, failures: 0 };
  function listen(target, onMessage, onOffline) {
    var id = 't' + (++hub.seq);
    hub.targets[id] = { t: target, on: onMessage, off: onOffline, last: null, got: false };
    restart(30);
    return function stop() { if (hub.targets[id]) { delete hub.targets[id]; restart(30); } };
  }
  function restart(ms) { clearTimeout(hub.timer); hub.timer = setTimeout(connect, ms); }
  function reopenAll() { hub.failures = 0; Object.keys(hub.targets).forEach(function (k) { hub.targets[k].last = null; }); restart(30); }
  function connect() {
    if (hub.ctl) { try { hub.ctl.abort(); } catch (_) {} hub.ctl = null; }
    var ids = Object.keys(hub.targets);
    if (!ids.length) return;
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    hub.ctl = ctl || {};
    var headers = { 'Content-Type': 'application/json' };
    if (session && session.token) headers['X-TA-Session'] = session.token;
    var body = JSON.stringify({ targets: ids.map(function (id) { var t = hub.targets[id].t; return t.doc ? { id: id, doc: t.doc } : { id: id, q: t.q }; }) });
    fetch(api('listen'), { method: 'POST', headers: headers, body: body, signal: ctl ? ctl.signal : undefined, cache: 'no-store' })
      .then(function (r) {
        if (!r.ok || !r.body || !r.body.getReader) throw fail('unavailable', 'HTTP ' + r.status);
        hub.failures = 0;
        return read(r.body.getReader());
      })
      .then(function () { if (hub.ctl === (ctl || hub.ctl)) { hub.ctl = null; restart(500); } })   // the server ends a stream after 25 min
      .catch(function () {
        if (ctl && ctl.signal.aborted) return;
        hub.ctl = null;
        Object.keys(hub.targets).forEach(function (k) { var x = hub.targets[k]; if (!x.got && x.off) { x.got = true; try { x.off(); } catch (_) {} } });
        hub.failures++;
        restart(Math.min(30000, 1000 * Math.pow(2, Math.min(hub.failures, 5))) + (navigator.onLine === false ? 4000 : 0));
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
  User.prototype.getIdToken = function () { return Promise.resolve(session && session.token || ''); };
  User.prototype.reauthenticateWithCredential = function (cred) {
    var u = this;
    return call('auth/signin', { email: u.email, password: cred && cred.password }, { session: null }).then(function () {
      u._old = cred.password; return { user: u };
    }, function (e) { if (e.code === 'auth/wrong-password') throw fail('auth/wrong-password', 'Неверный текущий код.'); throw e; });
  };
  User.prototype.updatePassword = function (p) {
    var u = this;
    if (!u._old) return Promise.reject(fail('auth/requires-recent-login', 'Введите текущий код ещё раз.'));
    return call('auth/password', { old: u._old, password: p }).then(function () { u._old = null; });
  };

  function Auth(app) {
    this.app = app; this._main = app.name === '[DEFAULT]'; this._observers = [];
    this.currentUser = this._main && session ? new User(session, this) : null;
    var self = this;
    if (this._main && session) {
      // the session is checked with the server once at start; a sign-in switched off / expired → signed out
      call('auth/refresh', {}).then(function (j) { setSession(j); }, function (e) {
        if (e.code !== 'unavailable') { setSession(null); self._emit(); }
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
  Auth.prototype.signInWithEmailAndPassword = function (email, password) {
    var self = this;
    return call('auth/signin', { email: String(email || ''), password: String(password || '') }, { session: null }).then(function (j) {
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
    if (this._main) { setSession(null); this.currentUser = null; reopenAll(); this._emit(); } else this.currentUser = null;
    return Promise.resolve();
  };
  Auth.prototype.sendPasswordResetEmail = function () {
    return Promise.reject(fail('auth/operation-not-allowed', 'Новый код выдаёт администратор в Trade Agent Desktop: «Сотрудники» → карточка → «Новый код».'));
  };
  Auth.prototype.setPersistence = function () { return Promise.resolve(); };

  function setSession(j) {
    session = j && j.token ? { uid: j.uid, email: j.email, token: j.token } : null;
    lsSet(SESSION_KEY, session ? JSON.stringify(session) : null);
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
  window.TA_STORE = { server: server, setServer: function (u) { lsSet('ta.server', u); }, session: function () { return session; },
    targets: function () { return Object.keys(hub.targets).map(function (k) { var x = hub.targets[k]; return (x.t.doc || ('q:' + x.t.q.parent)) + (x.got ? ' ✓' : ' …'); }); } };
})();
