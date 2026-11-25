/* Trade Agent Manager — казахский язык экранов (решение владельца 16.11 / 21.11).
   Экран не переписывается: этот файл подменяет на лету русские надписи, у которых есть перевод в словаре
   (i18n-kk-dict.js, собирается tools/i18n/kk_phone.py из словаря Desktop). Без перевода — остаётся русский.
   - выбор языка: «Профиль» → «Тіл / Язык», и на экране входа; запоминается на телефоне (localStorage «ta.lang»);
   - тексты между тегами и подсказки (placeholder, title, aria-label); новые и изменённые узлы — через MutationObserver
     (пачкой, один раз за кадр); поля ввода и то, что набрал человек, не трогаются;
   - шаблоны с числами: «Тізімде {0}»; оформление вокруг известного текста (пробелы, «:», «…», «+ », заглавные) сохраняется;
   - возврат к русскому — без перезагрузки: каждый переведённый узел помнит свой русский текст. */
(function () {
  'use strict';
  var KEY = 'ta.lang';
  var DICT = window.TA_KK_DICT || {};
  var lang = 'ru';
  try { lang = localStorage.getItem(KEY) === 'kk' ? 'kk' : 'ru'; } catch (_) {}
  var CYR = /[А-Яа-яЁё]/;
  var PRE = ['+ ', '＋ ', '✓ ', '• ', '· ', '← ', '‹ ', '→ ', '— ', '№ '];
  var SUF = [':', '…', '...', ' ▾', ' ›', ' →', ' *', '.', '?', '!', ' ✓', ' —'];
  var HOLE = /\{(\d)\}/g;
  var cache = new Map();
  var orig = new WeakMap();      // text node / element → {v: русский, k: казахский} (or per attribute)
  var templates = [];
  Object.keys(DICT).forEach(function (ru) {
    if (ru.indexOf('{0}') < 0) return;
    var parts = ru.split(/\{\d\}/);
    var lit = parts.join('');
    if (lit.trim().length < 4) return;
    var rx = '^' + ru.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{(\d)\\?\}/g, '(.+?)') + '$';
    try { templates.push({ rx: new RegExp(rx), kk: DICT[ru], anchor: parts.sort(function (a, b) { return b.length - a.length; })[0], len: lit.length }); } catch (_) {}
  });
  templates.sort(function (a, b) { return b.len - a.len; });

  function upper(t) { var l = t.replace(/[^A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/g, ''); return l.length >= 2 && l === l.toUpperCase(); }

  /* 229: a value that is a Russian sentence (an imperative, or two verb forms), not a name — same rule as KkDictionary.cs */
  var RU_WORD = /[а-яё]{5,}/g, IMPER = /^[а-яё]{3,}(ите|йте)$/, VERB = /^[а-яё]{3,}(ет|ёт|ит|ут|ют|ат|ят|ется|ится|ются|ятся|ался|алась|ился|илась|лось|лись|ен|ён|ена|ено|ены|ан|ана|ано|аны)$/;
  function ruPhrase(v, res) {
    var words = String(v).match(RU_WORD) || [], verbs = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i], at = String(v).indexOf(w), before = at > 0 ? String(v).charAt(at - 1) : '';
      if (/[А-Яа-яЁёA-Za-z]/.test(before) || String(res).indexOf(w) < 0) continue;
      if (IMPER.test(w)) return true;
      if (VERB.test(w) && ++verbs >= 2) return true;
    }
    return false;
  }
  function fromTemplate(t, d) {
    for (var i = 0; i < templates.length; i++) {
      var tp = templates[i];
      if (tp.anchor && t.indexOf(tp.anchor) < 0) continue;
      var m = tp.rx.exec(t);
      if (!m) continue;
      var vals = m.slice(1).map(function (v) { return compute(v, d + 1) || v; });
      if (ruPhrase(m.slice(1).join(' '), vals.join(' '))) continue;   // 229: a Russian sentence in a broad template — it does not fit
      var r = tp.kk.replace(HOLE, function (h, n) { return vals[+n] != null ? vals[+n] : h; });
      if (r !== t) return r;
    }
    return null;
  }

  function compute(t, d) {
    if (Object.prototype.hasOwnProperty.call(DICT, t)) return DICT[t];
    if (d > 4 || !t) return null;
    var r, i;
    if (upper(t)) { r = compute(t.charAt(0) + t.slice(1).toLowerCase(), d + 1); if (r) return r.toUpperCase(); }
    var c0 = t.charAt(0);
    if (c0 !== c0.toUpperCase()) {
      var cap = c0.toUpperCase() + t.slice(1);
      if (Object.prototype.hasOwnProperty.call(DICT, cap)) { r = DICT[cap]; return r.charAt(0).toLowerCase() + r.slice(1); }
    }
    var core = t.trim();
    if (core !== t) {
      if (!core) return null;
      r = compute(core, d + 1);
      return r ? t.slice(0, t.indexOf(core)) + r + t.slice(t.indexOf(core) + core.length) : null;
    }
    var sp = t.replace(/\s+/g, ' ');
    if (sp !== t && (r = compute(sp, d + 1))) return r;
    // a message of several sentences (the server glues them): the whole text first (a template may hold several sentences), then each
    // sentence on its own with its closing mark — before the loops below take the closing mark off.
    // (no look-behind in the pattern: older iPhone browsers do not parse it and the whole file would be lost)
    var raw = t.split(/([.!?;])(\s+)/);
    if (raw.length >= 4) {
      if (d <= 1 && (r = fromTemplate(t, d))) return r;
      var out = '', any = false, k, sentence, tail;
      for (k = 0; k < raw.length; k += 3) {
        sentence = raw[k] + (raw[k + 1] || '');
        tail = raw[k + 2] || '';
        r = sentence ? compute(sentence, d <= 1 ? 1 : d + 1) : null;
        if (r) any = true;
        out += (r || sentence) + tail;
      }
      if (any) return out;
    }
    for (i = 0; i < PRE.length; i++) if (t.length > PRE[i].length && t.indexOf(PRE[i]) === 0 && (r = compute(t.slice(PRE[i].length), d + 1))) return PRE[i] + r;
    for (i = 0; i < SUF.length; i++) {
      var s = SUF[i];
      if (t.length > s.length && t.slice(-s.length) === s && (r = compute(t.slice(0, -s.length), d + 1))) return r + s;
    }
    return d <= 1 ? fromTemplate(t, d) : null;
  }

  function tr(t) {
    if (!t || !CYR.test(t)) return null;
    if (cache.has(t)) return cache.get(t);
    var r = null;
    try { r = compute(t, 0); } catch (_) {}
    if (cache.size > 20000) cache.clear();
    cache.set(t, r);
    return r;
  }

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 0, NOSCRIPT: 1, CODE: 1 };
  function keep(el) { return el && el.closest && el.closest('[data-kk-keep],[contenteditable="true"]'); }

  // data typed by people stays as typed (21.11): names of clients, goods, points, users, notes from the local base and the
  // catalogue are collected (at most every 3 s while Kazakh is on) and never translated — «Магазин», «Банк» as a client name
  var DATA = new Set(), dataAt = 0;
  var DATA_KEYS = { name: 1, n: 1, client: 1, clientName: 1, point: 1, pointName: 1, address: 1, addr: 1, note: 1, comment: 1,
    driver: 1, brand: 1, city: 1, company: 1, contact: 1, shop: 1, store: 1, warehouse: 1, whName: 1, legalName: 1 };
  function collect(v, key, depth, budget) {
    if (budget.n-- <= 0 || v == null) return;
    if (typeof v === 'string') { if (key && DATA_KEYS[key] && CYR.test(v) && v.length < 160) DATA.add(v.trim()); return; }
    if (typeof v !== 'object' || depth > 5) return;
    if (Array.isArray(v)) { for (var i = 0; i < v.length && budget.n > 0; i++) collect(v[i], key, depth + 1, budget); return; }
    for (var k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) collect(v[k], k, depth + 1, budget); }
  }
  function refreshData() {
    var now = Date.now();
    if (now - dataAt < 3000) return;
    dataAt = now;
    var b = { n: 60000 };
    try { if (typeof DB !== 'undefined' && DB) collect(DB, '', 0, b); } catch (_) {}
    try {
      if (typeof CATALOG !== 'undefined' && CATALOG) {
        collect(CATALOG.prods, 'n', 0, b);
        (CATALOG.cats || []).forEach(function (c) { if (typeof c === 'string' && CYR.test(c)) DATA.add(c.trim()); });
      }
    } catch (_) {}
    if (DATA.size > 30000) DATA.clear();
  }
  window.TA_KK_IS_DATA = function (t) { refreshData(); return DATA.has(String(t || '').trim()); };

  function doText(n) {
    var o = orig.get(n);
    if (lang !== 'kk') { if (o && n.nodeValue === o.k) n.nodeValue = o.v; return; }
    var p = n.parentNode;
    if (!p || SKIP[p.nodeName] === 1 || keep(p)) return;
    var cur = n.nodeValue;
    if (o && cur === o.k) return;
    if (DATA.has(cur.trim())) return;
    var k = tr(cur);
    if (k && k !== cur) { orig.set(n, { v: cur, k: k }); n.nodeValue = k; }
  }

  var ATTRS = ['placeholder', 'title', 'aria-label'];
  function doAttrs(el) {
    if (keep(el)) return;
    var o = orig.get(el) || {};
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var cur = el.getAttribute(a), rec = o[a];
      if (lang !== 'kk') { if (rec && cur === rec.k) el.setAttribute(a, rec.v); continue; }
      if (rec && cur === rec.k) continue;
      var k = tr(cur);
      if (k && k !== cur) { o[a] = { v: cur, k: k }; orig.set(el, o); el.setAttribute(a, k); }
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (SKIP[root.nodeName] === 1 && root.nodeName !== 'INPUT' && root.nodeName !== 'TEXTAREA') return; doAttrs(root); }
    var w = document.createTreeWalker(root, 5 /* ELEMENT | TEXT */, null);
    var n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) doText(n);
      else doAttrs(n);
    }
  }

  // changes: collected and handled once per frame
  var pending = new Set(), scheduled = false;
  function flush() {
    scheduled = false;
    var list = Array.from(pending); pending.clear();
    var t0 = performance.now();
    if (lang !== 'kk') return;
    refreshData();
    list.forEach(function (n) { if (n.isConnected) walk(n); });
    window.TA_KK_LAST_MS = performance.now() - t0;
    window.TA_KK_FLUSHES = (window.TA_KK_FLUSHES || 0) + 1;
  }
  function queue(n) { pending.add(n); if (!scheduled) { scheduled = true; requestAnimationFrame(flush); } }
  var mo = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'characterData') queue(r.target);
      else if (r.type === 'attributes') queue(r.target);
      else for (var j = 0; j < r.addedNodes.length; j++) queue(r.addedNodes[j]);
    }
  });

  // ---------------------------------------------------------------- the switch «Русский / Қазақша»
  function pill() {
    var box = document.createElement('div');
    box.className = 'kk-lang';
    box.setAttribute('data-kk-keep', '1');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Тіл / Язык');
    [['ru', 'Русский'], ['kk', 'Қазақша']].forEach(function (x) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = x[1]; b.dataset.lang = x[0];
      if (x[0] === lang) b.className = 'on';
      b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); setLang(x[0]); });
      box.appendChild(b);
    });
    return box;
  }
  function attachSwitches() {
    // the profile sheet: before «Сменить пароль / Выйти» (profile 26+), or before the legal line (older profile)
    var legal = document.querySelector('.ta26-profile-actions') || document.querySelector('.profile-legal');
    if (legal && !legal.parentNode.querySelector('.kk-lang-row')) {
      var row = document.createElement('div');
      row.className = 'kk-lang-row';
      var label = document.createElement('span');
      label.textContent = 'Тіл / Язык';
      label.setAttribute('data-kk-keep', '1');
      row.appendChild(label); row.appendChild(pill());
      legal.parentNode.insertBefore(row, legal);
    }
    var login = document.getElementById('login');
    if (login && !login.querySelector('.kk-lang')) {
      var p = pill(); p.classList.add('kk-lang-login');
      login.appendChild(p);
    }
    document.querySelectorAll('.kk-lang button').forEach(function (b) { b.classList.toggle('on', b.dataset.lang === lang); });
  }
  var css = document.createElement('style');
  css.textContent = '.kk-lang{display:inline-flex;gap:2px;padding:2px;border:1px solid rgba(255,255,255,.09);border-radius:12px;background:rgba(255,255,255,.03)}' +
    '.kk-lang button{min-height:34px;padding:0 12px;border:0;border-radius:10px;background:transparent;color:var(--mut,#909E97);font:inherit;font-size:13px;font-weight:600}' +
    '.kk-lang button.on{background:rgba(114,176,145,.16);color:#72B091}' +
    '.kk-lang-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0 4px;padding:8px 2px;font-size:13px;color:var(--mut,#909E97)}' +
    '.kk-lang-login{position:absolute;top:calc(env(safe-area-inset-top,0px) + 10px);right:12px;z-index:5}';
  document.head.appendChild(css);

  // the observer runs only while Kazakh is on; in Russian the page is not watched at all
  var observing = false;
  function observe(on) {
    if (on && !observing) { mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); observing = true; }
    else if (!on && observing) { mo.disconnect(); pending.clear(); observing = false; }
    window.TA_KK_OBSERVING = observing;
  }
  // the switch is put into the profile sheet / sign-in screen after a tap (they open on a tap), not on every frame
  var switchTimer = 0;
  function laterSwitches() {
    clearTimeout(switchTimer);
    switchTimer = setTimeout(function () { attachSwitches(); setTimeout(attachSwitches, 350); }, 60);
  }

  function setLang(v) {
    lang = v === 'kk' ? 'kk' : 'ru';
    try { localStorage.setItem(KEY, lang); } catch (_) {}
    document.documentElement.lang = lang === 'kk' ? 'kk' : 'ru';
    var t0 = performance.now();
    if (lang === 'kk') { dataAt = 0; refreshData(); }
    walk(document.body);
    observe(lang === 'kk');
    window.TA_KK_SWITCH_MS = performance.now() - t0;
    attachSwitches();
    // texts built in code for the current language (the date on the sign-in screen etc.) are rebuilt by their owners
    try { document.dispatchEvent(new CustomEvent('ta:lang', { detail: lang })); } catch (_) {}
  }

  window.TA_LANG = { get: function () { return lang; }, set: setLang, t: function (s) { return lang === 'kk' ? (tr(s) || s) : s; } };

  function start() {
    document.documentElement.lang = lang === 'kk' ? 'kk' : 'ru';
    if (lang === 'kk') { var t0 = performance.now(); refreshData(); walk(document.body); window.TA_KK_START_MS = performance.now() - t0; }
    attachSwitches();
    observe(lang === 'kk');
    document.addEventListener('click', laterSwitches, true);
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
