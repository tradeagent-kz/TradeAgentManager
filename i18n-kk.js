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
    // К-1 (пятая проверка), as KkDictionary.cs: the fixed pieces around the values, matched without a regular expression — a
    // pattern with several «(.+?)» backtracked over a long glued text for seconds; match() gives the same values
    templates.push({ pieces: parts.slice(), kk: DICT[ru], anchor: parts.sort(function (a, b) { return b.length - a.length; })[0], len: lit.length });
  });
  templates.sort(function (a, b) { return b.len - a.len; });
  // a template can only fit a text that starts with its first fixed piece and ends with its last one: the templates are kept by the
  // first two letters of the start (or else the last two of the end); a text tries only its own groups and the open ones, in the
  // same order as the whole list (the first that fits wins, as before)
  var byEdge = {}, open = [];
  templates.forEach(function (tp, i) {
    var head = tp.pieces[0], tail = tp.pieces[tp.pieces.length - 1];
    tp.at = i;
    if (head.length >= 2) (byEdge['^' + head.slice(0, 2)] = byEdge['^' + head.slice(0, 2)] || []).push(tp);
    else if (tail.length >= 2) (byEdge['$' + tail.slice(-2)] = byEdge['$' + tail.slice(-2)] || []).push(tp);
    else open.push(tp);
  });
  function candidates(t) {
    var lists = [byEdge['^' + t.slice(0, 2)], byEdge['$' + t.slice(-2)], open].filter(Boolean), out = [], pos = [0, 0, 0], best, k, tp;
    for (;;) {
      best = -1;
      for (k = 0; k < lists.length; k++) if (pos[k] < lists[k].length && (best < 0 || lists[k][pos[k]].at < lists[best][pos[best]].at)) best = k;
      if (best < 0) return out;
      tp = lists[best][pos[best]++];
      out.push(tp);
    }
  }

  /* The values of a template in a text (in the order of the text), or null: exactly what the regular expression
     «^piece0(.+?)piece1(.+?)…$» gave — a value is never empty and never holds a line break (the «.» of a pattern without flags),
     each value is the shortest that lets the rest fit; a place that cannot finish the match is remembered and never tried twice,
     so the time is linear in the places tried. */
  var LINE_BREAK = /[\n\r\u2028\u2029]/, LINE_BREAKS = /[\n\r\u2028\u2029]/g;
  function match(pieces, t) {
    var n = pieces.length - 1, head = pieces[0], tail = pieces[n], end = t.length - tail.length;
    if (n < 1 || end < head.length + n || t.slice(0, head.length) !== head || t.slice(end) !== tail) return null;
    var stop = null;   // stop[i]: where the first line break at or after i is (no value may cross it)
    if (LINE_BREAK.test(t)) {
      stop = []; var next = t.length, i, m, breaks = [];
      LINE_BREAKS.lastIndex = 0;
      while ((m = LINE_BREAKS.exec(t))) breaks.push(m.index);
      for (i = t.length; i >= 0; i--) { if (breaks.length && breaks[breaks.length - 1] === i) next = breaks.pop(); stop[i] = next; }
    }
    var starts = [], dead = {};
    function place(i, from) {
      starts[i] = from;
      var limit = stop ? Math.min(end, stop[from]) : end;
      if (i === n - 1) return limit === end && end - from >= 1;
      var key = i + ':' + from;
      if (dead[key]) return false;
      var piece = pieces[i + 1];
      for (var at = from + 1; at <= limit; at++) {
        if (piece.length) { at = t.indexOf(piece, at); if (at < 0 || at > limit || at + piece.length > end) break; }
        if (place(i + 1, at + piece.length)) return true;
      }
      dead[key] = 1;
      return false;
    }
    if (!place(0, head.length)) return null;
    var values = [];
    for (var k = 0; k < n; k++) values.push(t.slice(starts[k], k === n - 1 ? end : starts[k + 1] - pieces[k + 1].length));
    return values;
  }

  function upper(t) { var l = t.replace(/[^A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/g, ''); return l.length >= 2 && l === l.toUpperCase(); }

  /* 229: a value that is a Russian sentence (an imperative, or two verb forms), not a name — same rule as KkDictionary.cs */
  var RU_WORD = /[а-яё]{5,}/g, IMPER = /^[а-яё]{3,}(ите|йте)$/, VERB = /^[а-яё]{3,}(ет|ёт|ит|ут|ют|ат|ят|ется|ится|ются|ятся|ался|алась|ился|илась|лось|лись|ен|ён|ена|ено|ены|ан|ана|ано|аны)$/;
  var LINKS = {}; ['в', 'во', 'на', 'по', 'с', 'со', 'до', 'от', 'из', 'за', 'к', 'ко', 'и', 'а', 'о', 'об', 'у', 'для', 'при', 'без', 'или', 'не'].forEach(function (w) { LINKS[w] = 1; });
  function ruPhrase(v, res) {
    var words = String(v).match(RU_WORD) || [], verbs = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i], at = String(v).indexOf(w), before = at > 0 ? String(v).charAt(at - 1) : '';
      if (/[А-Яа-яЁёA-Za-z]/.test(before) || String(res).indexOf(w) < 0) continue;
      if (IMPER.test(w)) return true;
      if (VERB.test(w) && ++verbs >= 2) return true;
    }
    // 247: three long small-letter Russian words left as they are outside «quotes» — a phrase, not a name
    var bare = String(v).replace(/«[^«»]*»|"[^"]*"/g, ' '), rest = bare.match(RU_WORD) || [], left = 0;
    for (var j = 0; j < rest.length; j++) {
      var at2 = bare.indexOf(rest[j]), b2 = at2 > 0 ? bare.charAt(at2 - 1) : '';
      if (/[А-Яа-яЁёA-Za-z]/.test(b2) || String(res).indexOf(rest[j]) < 0) continue;
      if (++left >= 3) return true;
    }
    return false;
  }
  function fromTemplate(t, d) {
    var list = candidates(t);
    for (var i = 0; i < list.length; i++) {
      var tp = list[i];
      if (tp.anchor && t.indexOf(tp.anchor) < 0) continue;
      var found = match(tp.pieces, t);
      if (!found) continue;
      var vals = found.map(function (v) { return LINKS[String(v).trim()] ? v : compute(v, d + 1) || segments(v) || v; });   // 247: «по», «с» — a piece of a phrase
      if (ruPhrase(found.join(' '), vals.join(' '))) continue;   // 229: a Russian sentence in a broad template — it does not fit
      var r = tp.kk.replace(HOLE, function (h, n) { return vals[+n] != null ? vals[+n] : h; });
      if (r !== t) return r;
    }
    return null;
  }

  /* 254: a month or a day in Russian words («ноябрь 2026», «Ноябрь 2026 г.», «27 ноября», «пятница, 27 ноября», «нояб 26») — a rule,
     the same as KkDictionary.KkDate (computer) and kk_lookup.py */
  var KK_M = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];
  var KK_MS = ['қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау', 'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел'];
  var RU_M = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  var RU_MOF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var RU_MS = [['янв'], ['фев', 'февр'], ['мар', 'март'], ['апр'], ['май', 'мая'], ['июн', 'июнь'], ['июл', 'июль'], ['авг'], ['сен', 'сент'], ['окт'], ['ноя', 'нояб'], ['дек']];
  var RU_W = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
  var KK_W = ['дүйсенбі', 'сейсенбі', 'сәрсенбі', 'бейсенбі', 'жұма', 'сенбі', 'жексенбі'];
  var RX_MY = new RegExp('^(' + RU_M.join('|') + ')[ \\u00a0](\\d{4})([ \\u00a0]г\\.?|[ \\u00a0]года)?$', 'i');
  var RX_DM = new RegExp('^(?:(' + RU_W.join('|') + '),[ \\u00a0])?(\\d{1,2})[ \\u00a0](' + RU_MOF.join('|') + ')(?:[ \\u00a0](\\d{4})(?:[ \\u00a0]г\\.?|[ \\u00a0]года)?)?$', 'i');
  var RX_MS = /^(янв|февр|фев|март|мар|апр|май|мая|июнь|июн|июль|июл|авг|сент|сен|окт|нояб|ноя|дек)\.?[ \u00a0](\d{2}|\d{4})$/i;
  function kkDate(t) {
    if (t.length < 5 || t.length > 64 || !/^[0-9A-Za-zА-Яа-яЁё]/.test(t)) return null;
    var m, kk = null, n, i, colon = t.indexOf(': ');
    if (colon > 0) { n = CYR.test(t.slice(colon + 2)) ? null : kkDate(t.slice(0, colon)); return n ? n + t.slice(colon) : null; }   // «ноябрь 2026: 1 250 ₸»
    if ((m = RX_MY.exec(t))) { n = KK_M[RU_M.indexOf(m[1].toLowerCase())]; kk = m[3] ? m[2] + ' жылғы ' + n : n + ' ' + m[2]; }
    else if ((m = RX_DM.exec(t))) {
      kk = (m[4] ? m[4] + ' жылғы ' : '') + m[2] + ' ' + KK_M[RU_MOF.indexOf(m[3].toLowerCase())];
      if (m[1]) kk = KK_W[RU_W.indexOf(m[1].toLowerCase())] + ', ' + kk;
    } else if ((m = RX_MS.exec(t))) {
      n = m[1].toLowerCase();
      for (i = 0; i < RU_MS.length; i++) if (RU_MS[i].indexOf(n) >= 0) { kk = KK_MS[i] + ' ' + m[2]; break; }
    }
    if (!kk) return null;
    var c = t.charAt(0);
    return c !== c.toLowerCase() && kk.charAt(0) !== kk.charAt(0).toUpperCase() ? kk.charAt(0).toUpperCase() + kk.slice(1) : kk;
  }

  function computeCore(t, d) {
    if (Object.prototype.hasOwnProperty.call(DICT, t)) return DICT[t];
    var dt = kkDate(t);
    if (dt) return dt;
    if (d > 4 || !t) return null;
    var r, i;
    if (upper(t)) { r = compute(t.charAt(0) + t.slice(1).toLowerCase(), d + 1); if (r) return r.toUpperCase(); }
    var c0 = t.charAt(0);
    if (c0 !== c0.toUpperCase()) {
      var cap = c0.toUpperCase() + t.slice(1);
      if (Object.prototype.hasOwnProperty.call(DICT, cap)) { r = DICT[cap]; return r.charAt(0).toLowerCase() + r.slice(1); }
    } else if (c0 !== c0.toLowerCase()) {
      // fix6: «НА СВЯЗИ» (a status written in small letters and shown in capitals) — the dictionary has «на связи»
      var low = c0.toLowerCase() + t.slice(1);
      if (Object.prototype.hasOwnProperty.call(DICT, low)) { r = DICT[low]; return r.charAt(0).toUpperCase() + r.slice(1); }
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
        r = sentence ? compute(sentence, d <= 1 ? 1 : d + 1) || segments(sentence) : null;
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

  // 247: a line glued from parts with « · » (a whole text, a sentence, a template value): when it has no translation, each part on
  // its own, after every other way failed (as on the computer). 251: also « — », « → » and «, » (not inside brackets or quotes);
  // a part is tried whole first, then by the next joint
  var JOINTS = [' · ', ' — ', ' → ', ', '];
  function count(s, c) { return s.split(c).length - 1; }
  function balanced(p) { return count(p, '(') === count(p, ')') && count(p, '«') === count(p, '»') && count(p, '"') % 2 === 0; }
  function segmentsCore(t, from) {
    for (var k = from || 0; k < JOINTS.length; k++) {
      var joint = JOINTS[k];
      if (t.indexOf(joint) < 0 || (k > 0 && t.indexOf('<') >= 0)) continue;
      var parts = t.split(joint), any = false, j, r2;
      if (k === JOINTS.length - 1 && !parts.every(balanced)) continue;
      for (j = 0; j < parts.length; j++) if (parts[j] && /[А-Яа-яЁё]/.test(parts[j]) && (r2 = compute(parts[j], 0) || segments(parts[j], k + 1))) { parts[j] = r2; any = true; }
      return any ? parts.join(joint) : null;
    }
    return null;
  }

  // К-1 (пятая проверка), as KkDictionary.cs: every translation is bounded. The ways above call each other on the parts of a text
  // (a sentence → a template value → the parts between « · », « — », «, » → a template again …) and meet the same part many times:
  // within one translation each part is worked out once (the same text at the same depth gives the same answer, so the result is
  // the same as before), and the work has a ceiling — a text that needs more than STEP_LIMIT steps or TIME_LIMIT_MS stays as it is
  // (Russian): the screen never waits for the dictionary.
  var STEP_LIMIT = 40000, TIME_LIMIT_MS = 250, LIMIT = {};
  var memo = null, steps = 0, deadline = 0, lastSteps = 0;
  function step() {
    if (++steps > STEP_LIMIT || ((steps & 255) === 0 && Date.now() > deadline)) throw LIMIT;
  }
  function remembered(key, work) {
    if (!memo) return work();
    if (memo.has(key)) return memo.get(key);
    step();
    var r = work();
    memo.set(key, r);
    return r;
  }
  function compute(t, d) { return remembered(d + '|' + t, function () { return computeCore(t, d); }); }
  // segments: the key holds −1 − the first joint tried (compute uses 0 and up)
  function segments(t, from) { from = from || 0; return remembered((-1 - from) + '|' + t, function () { return segmentsCore(t, from); }); }
  function bounded(t) {
    if (memo) return compute(t, 0) || segments(t);   // already inside a translation (never expected): the same limits go on
    memo = new Map(); steps = 0; deadline = Date.now() + TIME_LIMIT_MS;
    try { return compute(t, 0) || segments(t); } catch (_) { return null; }   // over the limit or an error: the text stays as it is
    finally { lastSteps = steps; memo = null; }
  }

  function tr(t) {
    if (!t || !CYR.test(t)) return null;
    if (cache.has(t)) return cache.get(t);
    var r = bounded(t);
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
  // checks (tools/i18n/kk_js_check.js): a translation worked out anew (not from the cache) with the same limits, the steps it took,
  // the template matcher
  window.TA_KK_ENGINE = { uncached: function (s) { return !s || !CYR.test(s) ? null : bounded(s); }, lastSteps: function () { return lastSteps; },
    stepLimit: STEP_LIMIT, match: match };

  function start() {
    document.documentElement.lang = lang === 'kk' ? 'kk' : 'ru';
    if (lang === 'kk') { var t0 = performance.now(); refreshData(); walk(document.body); window.TA_KK_START_MS = performance.now() - t0; }
    attachSwitches();
    observe(lang === 'kk');
    document.addEventListener('click', laterSwitches, true);
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
