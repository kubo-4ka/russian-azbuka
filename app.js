'use strict';

/* =========================================================
 * 小さな道具
 * ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const store = {
  get(k, d) { try { const v = localStorage.getItem('az.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('az.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};

const DEFAULTS = {
  view: 'quiz', count: '10', kbd: 'abc',
  groups: LETTER_GROUPS.map((g) => g.id), cats: WORD_CATS.map((c) => c.id),
  stress: true, weak: true, auto: false, speak: true,
  voice: '', rate: '0.8', volume: '1',
  face: 'print', hideReading: false, byGroup: true, songHide: false, lyricLat: true,
  spSource: 'letters', spIndex: 0
};
const settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);

let stats = store.get('stats', {});
function record(key, ok) {
  const s = stats[key] || (stats[key] = { ok: 0, ng: 0 });
  ok ? s.ok++ : s.ng++;
  store.set('stats', stats);
}
function rateOf(key) { const s = stats[key]; return s && s.ok + s.ng ? s.ok / (s.ok + s.ng) : null; }
function weightOf(key) {
  if (!settings.weak) return 1;
  const s = stats[key];
  if (!s) return 1.4;
  return 0.6 + 3 * (s.ng + 1) / (s.ok + s.ng + 2);
}
// 重み付きで n 個（重複なし）
function weightedSample(items, n, keyFn) {
  const pool = items.map((it) => ({ it, w: weightOf(keyFn(it)) }));
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((a, p) => a + p.w, 0);
    let r = Math.random() * total, i = 0;
    for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r <= 0) break; }
    out.push(pool.splice(i, 1)[0].it);
  }
  return out;
}

const showWord = (w) => settings.stress ? accent(w) : plain(w);
const wordKey = (w) => 'W:' + plain(w.w);
const letterKey = (l) => 'L:' + l.up;

/* =========================================================
 * ラテン文字への転写（歌詞や自由入力の読みのめやす）
 * ========================================================= */
const TR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: "'", э: 'e', ю: 'yu', я: 'ya'
};
const VOWELS = 'аеёиоуыэюя';
function translit(s) {
  s = plain(s);
  let out = '', prev = '';
  for (const ch of s) {
    const lo = ch.toLowerCase();
    if (!(lo in TR)) { out += ch; prev = ''; continue; }
    let t = TR[lo];
    if (lo === 'е' && (!prev || VOWELS.includes(prev) || prev === 'ъ' || prev === 'ь')) t = 'ye';
    if (ch !== lo && t) t = t[0].toUpperCase() + t.slice(1);
    out += t;
    prev = lo;
  }
  return out;
}
// 答え合わせ用：小文字・ё→е・記号を除く
function norm(s) {
  return plain(s).toLowerCase().replace(/ё/g, 'е').replace(/[^а-я\s-]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

/* =========================================================
 * 読み上げ（Web Speech API）
 * ========================================================= */
const synth = window.speechSynthesis || null;
let ruVoices = [];
function loadVoices() {
  ruVoices = synth ? synth.getVoices().filter((v) => /^ru(-|_|$)/i.test(v.lang)) : [];
  const sel = $('#optVoice');
  sel.innerHTML = ruVoices.length
    ? ruVoices.map((v) => `<option value="${esc(v.voiceURI)}">${esc(v.name)}（${esc(v.lang)}）</option>`).join('')
    : '<option value="">ロシア語の声が見つかりません</option>';
  if (ruVoices.some((v) => v.voiceURI === settings.voice)) sel.value = settings.voice;
  else if (ruVoices.length) {
    // 自然な声（Online / Natural / Google）を優先
    const best = ruVoices.find((v) => /natural|online|google/i.test(v.name)) || ruVoices[0];
    sel.value = best.voiceURI;
  }
  $('#speechHint').textContent = !synth
    ? 'このブラウザは読み上げに対応していません。'
    : ruVoices.length
      ? `ロシア語の声が ${ruVoices.length} 種類見つかりました。`
      : 'この端末にロシア語の読み上げ音声が見つかりません。「説明」タブの「読み上げについて」を参考に、ロシア語の音声を追加してください。';
  renderModes();
}
const canSpeak = () => !!synth && ruVoices.length > 0;
let speakingEl = null;
function speak(text, opt = {}) {
  if (!canSpeak()) { opt.onend && opt.onend(); return false; }
  synth.cancel();
  if (speakingEl) speakingEl.classList.remove('speaking');
  const u = new SpeechSynthesisUtterance(plain(text));
  u.lang = 'ru-RU';
  const v = ruVoices.find((x) => x.voiceURI === $('#optVoice').value) || ruVoices[0];
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = opt.rate || +settings.rate;
  u.volume = +settings.volume;
  if (opt.el) { speakingEl = opt.el; opt.el.classList.add('speaking'); }
  u.onend = u.onerror = () => {
    if (opt.el) opt.el.classList.remove('speaking');
    opt.onend && opt.onend();
  };
  synth.speak(u);
  return true;
}
// 画面のどこでも data-say を持つ要素はタップで読み上げ
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-say]');
  if (!el) return;
  e.preventDefault();
  if (!canSpeak()) { toastNoVoice(); return; }
  speak(el.dataset.say, { el });
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.ex[data-say]')) { e.preventDefault(); e.target.click(); }
});
let toastTimer = 0;
function toastNoVoice() {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = 'ロシア語の読み上げ音声が見つかりません（「発音」タブの設定を確認してください）';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* =========================================================
 * 音声認識（発音チェック）
 * ========================================================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let recog = null;
function listenRu(onResult, onState) {
  if (!SR) return;
  if (recog) { recog.abort(); recog = null; onState(false); return; }
  if (synth) synth.cancel();
  const r = new SR();
  r.lang = 'ru-RU';
  r.interimResults = false;
  r.maxAlternatives = 5;
  let got = false;
  r.onresult = (e) => { got = true; onResult(Array.from(e.results[0]).map((a) => a.transcript)); };
  r.onerror = (e) => { got = true; onResult(null, e.error); };
  r.onend = () => { recog = null; onState(false); if (!got) onResult([]); };
  recog = r;
  onState(true);
  try { r.start(); } catch (e) { recog = null; onState(false); onResult(null, 'start'); }
}
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}
const similarity = (a, b) => (!a.length && !b.length) ? 1 : 1 - levenshtein(a, b) / Math.max(a.length, b.length);
// お手本の各文字が、聞き取り結果と一致したか（LCS）
function markTarget(target, heard) {
  const m = target.length, n = heard.length;
  const L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) {
    L[i][j] = target[i] === heard[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const hit = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (target[i] === heard[j]) { hit[i] = true; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return Array.from(target).map((c, k) => c === ' ' ? ' ' : `<span class="${hit[k] ? 'hit' : 'miss'}">${esc(c)}</span>`).join('');
}
function judgeSpeech(targetText, alts, err) {
  if (err) {
    const msg = { 'not-allowed': 'マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください。', 'no-speech': '声が聞き取れませんでした。もう一度どうぞ。', network: '音声認識サーバーに接続できませんでした（ネット接続が必要です）。', 'audio-capture': 'マイクが見つかりません。' }[err];
    return `<p class="sp-score">${esc(msg || '音声認識でエラーが発生しました（' + err + '）。')}</p>`;
  }
  if (!alts.length) return '<p class="sp-score">声が聞き取れませんでした。もう一度どうぞ。</p>';
  const target = norm(targetText);
  let best = alts[0], bestScore = -1;
  alts.forEach((a) => { const s = similarity(target, norm(a)); if (s > bestScore) { bestScore = s; best = a; } });
  const pct = Math.round(bestScore * 100);
  const verdict = pct >= 90 ? 'ばっちり！ そのとおりに聞き取られました' : pct >= 70 ? 'おしい！ だいたい伝わっています' : pct >= 40 ? '一部が別の音に聞こえたようです' : 'うまく聞き取られませんでした。お手本を聞いてもう一度';
  return `<p class="sp-score">一致度 <b>${pct}%</b> — ${verdict}</p>
    <p class="sp-heard ru">${markTarget(target, norm(best))}</p>
    <p class="sp-score">聞き取られた言葉：<span class="ru">${esc(best)}</span></p>`;
}

/* =========================================================
 * 画面の切り替え・テーマ
 * ========================================================= */
function showView(id) {
  if (!$('#view-' + id)) id = 'quiz';
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + id));
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === id));
  settings.view = id; saveSettings();
  if (id === 'speak') renderSpeak();
  window.scrollTo(0, 0);
}
$$('.nav-item').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

$('#themeBtn').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('az.theme', root.dataset.theme); } catch (e) { /* ignore */ }
});

function makeSeg(el, options, value, onChange) {
  el.innerHTML = options.map(([v, label]) => `<button type="button" role="radio" data-v="${v}" aria-checked="${v === value}">${label}</button>`).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', el).forEach((x) => x.setAttribute('aria-checked', x === b));
    onChange(b.dataset.v);
  });
}
function makeChips(el, options, selected, onChange) {
  el.innerHTML = options.map(([v, label]) => `<button type="button" class="chip" data-v="${v}" aria-pressed="${selected.includes(v)}">${label}</button>`).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    const cur = $$('.chip', el).filter((x) => x === b ? on : x.getAttribute('aria-pressed') === 'true');
    if (!cur.length) return; // 1つは残す
    b.setAttribute('aria-pressed', on);
    onChange(cur.map((x) => x.dataset.v));
  });
}

/* =========================================================
 * 文字
 * ========================================================= */
const FACES = [['print', 'ふつう'], ['italic', 'イタリック'], ['script', '筆記体']];
const faceClass = (f) => f === 'italic' ? 'it' : f === 'script' ? 'script' : '';

function letterCard(l) {
  const r = rateOf(letterKey(l));
  return `<button type="button" class="card${l.group === 'false' ? ' false-friend' : ''}" data-i="${LETTERS.indexOf(l)}">
    <div class="pair ru ${faceClass(settings.face)}"><span class="up">${l.up}</span><span class="lo">${l.lo}</span></div>
    <div class="lat">${esc(l.lat)}</div>
    <div class="kana">${esc(l.kana)}</div>
    ${r === null ? '' : `<span class="bar" style="width:${Math.round(r * 100)}%"></span>`}
  </button>`;
}
function renderLetters() {
  const box = $('#alphaGrid');
  const cls = 'grid' + (settings.hideReading ? ' hide-reading' : '');
  box.innerHTML = settings.byGroup
    ? LETTER_GROUPS.map((g) => `<div class="group-head"><h2>${g.name}</h2><p>${g.desc}</p></div>
        <div class="${cls}">${LETTERS.filter((l) => l.group === g.id).map(letterCard).join('')}</div>`).join('')
    : `<div class="${cls}">${LETTERS.map(letterCard).join('')}</div>`;
}
makeSeg($('#faceSeg'), FACES, settings.face, (v) => { settings.face = v; saveSettings(); renderLetters(); });
$('#hideReading').checked = settings.hideReading;
$('#hideReading').addEventListener('change', (e) => { settings.hideReading = e.target.checked; saveSettings(); renderLetters(); });
$('#byGroup').checked = settings.byGroup;
$('#byGroup').addEventListener('change', (e) => { settings.byGroup = e.target.checked; saveSettings(); renderLetters(); });
$('#alphaGrid').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) openLetter(+c.dataset.i); });

let dlgIndex = 0;
function openLetter(i) {
  dlgIndex = (i + LETTERS.length) % LETTERS.length;
  const l = LETTERS[dlgIndex];
  $('#dlgPair').innerHTML = `<span class="${faceClass(settings.face)}">${l.up}${l.lo}</span>`;
  $('#dlgFaces').innerHTML = FACES.map(([f, label]) => `<span class="${faceClass(f)}">${l.up}${l.lo}<small>${label}</small></span>`).join('');
  $('#dlgName').innerHTML = `名前：<span class="ex" data-say="${esc(plain(l.name))}" role="button" tabindex="0"><span class="ru">${accent(l.name)}</span></span>（${esc(l.nameKana)}）`;
  $('#dlgSound').textContent = `音：${l.kana} ／ ラテン文字では ${l.lat}`;
  $('#dlgNote').innerHTML = accent(l.note);
  $('#dlgEx').innerHTML = '例：' + R(l.ex.w, l.ex.kana, l.ex.ja);
  const s = stats[letterKey(l)];
  $('#dlgStat').textContent = s ? `クイズ：${s.ok + s.ng} 回中 ${s.ok} 回正解` : 'クイズではまだ出題されていません';
  const d = $('#letterDialog');
  if (!d.open) d.showModal();
}
$('#dlgPrev').addEventListener('click', () => openLetter(dlgIndex - 1));
$('#dlgNext').addEventListener('click', () => openLetter(dlgIndex + 1));
$('#letterDialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

/* =========================================================
 * 解説
 * ========================================================= */
function renderGuide() {
  let part = '', toc = '';
  GUIDE.forEach((g) => {
    if (g.part !== part) { part = g.part; toc += `<span class="toc-part">${part}</span>`; }
    toc += `<a href="#g-${g.id}" data-g="${g.id}">${g.title}</a>`;
  });
  $('#guideToc').innerHTML = toc;
  $('#guideBody').innerHTML = GUIDE.map((g, i) => `<details class="guide-sec" id="g-${g.id}"${i === 0 ? ' open' : ''}>
    <summary><span class="part">${g.part}</span><h3>${g.title}</h3></summary>
    <div class="guide-body">${g.body}</div></details>`).join('');
  $('#guideToc').addEventListener('click', (e) => {
    const a = e.target.closest('a'); if (!a) return;
    e.preventDefault();
    const sec = $('#g-' + a.dataset.g);
    sec.open = true;
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* =========================================================
 * カチューシャ
 * ========================================================= */
const SONG_WORDS = WORDS.filter((w) => w.cat === 'song');
function renderSong() {
  $('#songTitle').textContent = accent(SONG_INFO.title);
  $('#songTitle').dataset.say = plain(SONG_INFO.title);
  $('#songMeta').innerHTML = `<dt>発表</dt><dd>${SONG_INFO.year} 年</dd><dt>作曲</dt><dd>${accent(SONG_INFO.music)}</dd><dt>作詞</dt><dd>${accent(SONG_INFO.lyrics)}</dd>`;
  const list = $('#songWords');
  list.classList.toggle('hide-ja', settings.songHide);
  list.innerHTML = SONG_WORDS.map((w) => `<div class="word-item" data-say="${esc(plain(w.w))}" role="button" tabindex="0">
    <div class="ru">${accent(w.w)}</div>
    <div class="wk">${esc(w.kana)}　<span class="lat">${esc(translit(w.w))}</span></div>
    <div class="wj">${esc(w.ja)}</div>
    ${w.note ? `<div class="wn">${accent(esc(w.note))}</div>` : ''}
  </div>`).join('');
}
$('#songHide').checked = settings.songHide;
$('#songHide').addEventListener('change', (e) => { settings.songHide = e.target.checked; saveSettings(); renderSong(); });
$('#songWords').addEventListener('click', (e) => { const it = e.target.closest('.word-item'); if (it) it.classList.add('reveal'); });
$('#songQuizBtn').addEventListener('click', () => { showView('quiz'); startQuiz('song'); });
$('#songQuizJaBtn').addEventListener('click', () => { showView('quiz'); startQuiz('songJa'); });

// --- 入力した歌詞 ---
let lyrics = store.get('lyrics', '');
const TOKEN_RE = /[А-Яа-яЁё́+]+(?:-[А-Яа-яЁё́+]+)*/g;
const lyricLines = () => lyrics.split(/\r?\n/).map((s) => s.trim()).filter((s) => TOKEN_RE.test(s) && ((TOKEN_RE.lastIndex = 0), true));
function renderLyrics() {
  const has = lyricLines().length > 0;
  $('#lyricEdit').hidden = has && !$('#lyricEdit').classList.contains('editing');
  $('#lyricView').hidden = !$('#lyricEdit').hidden;
  $('#lyricCancel').hidden = !has;
  if ($('#lyricView').hidden) return;
  let n = -1;
  $('#lyricLines').innerHTML = lyrics.split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    if (!line || !line.match(TOKEN_RE)) return '<div class="lyric-line blank-line"></div>';
    n++;
    const html = esc(line).replace(TOKEN_RE, (t) => `<span class="tok" data-say="${esc(plain(t))}">${accent(t)}</span>`);
    return `<div class="lyric-line" data-n="${n}">
      <div class="lyric-text"><div class="ru">${html}</div>${settings.lyricLat ? `<div class="lyric-lat">${esc(translit(line))}</div>` : ''}</div>
      <div class="line-btns"><button type="button" data-act="play" aria-label="この行を読み上げ">♪</button><button type="button" data-act="mic" aria-label="この行で発音チェック">🎤</button></div>
    </div>`;
  }).join('');
}
$('#lyricInput').value = lyrics;
$('#lyricSave').addEventListener('click', () => {
  lyrics = $('#lyricInput').value.trim();
  store.set('lyrics', lyrics);
  $('#lyricEdit').classList.remove('editing');
  renderLyrics(); renderModes(); buildSpeakSources();
  if (lyrics && !lyricLines().length) alert('ロシア語（キリル文字）の行が見つかりませんでした。');
});
$('#lyricCancel').addEventListener('click', () => { $('#lyricInput').value = lyrics; $('#lyricEdit').classList.remove('editing'); renderLyrics(); });
$('#lyricEditBtn').addEventListener('click', () => { stopPlayAll(); $('#lyricEdit').classList.add('editing'); renderLyrics(); $('#lyricInput').focus(); });
$('#lyricClear').addEventListener('click', () => {
  if (!confirm('入力した歌詞を消去しますか？')) return;
  stopPlayAll();
  lyrics = ''; store.set('lyrics', ''); $('#lyricInput').value = '';
  renderLyrics(); renderModes(); buildSpeakSources();
});
$('#lyricLat').checked = settings.lyricLat;
$('#lyricLat').addEventListener('change', (e) => { settings.lyricLat = e.target.checked; saveSettings(); renderLyrics(); });
$('#lyricLines').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const row = b.closest('.lyric-line');
  const line = lyricLines()[+row.dataset.n];
  if (b.dataset.act === 'play') { if (!canSpeak()) return toastNoVoice(); stopPlayAll(); speak(line, { el: row }); }
  else { settings.spSource = 'lyrics'; settings.spIndex = +row.dataset.n; saveSettings(); showView('speak'); }
});
let playAllOn = false;
function stopPlayAll() { playAllOn = false; $('#lyricPlayAll').textContent = '♪ 全部読み上げ'; if (synth) synth.cancel(); $$('.lyric-line.playing').forEach((x) => x.classList.remove('playing')); }
$('#lyricPlayAll').addEventListener('click', () => {
  if (playAllOn) return stopPlayAll();
  if (!canSpeak()) return toastNoVoice();
  playAllOn = true;
  $('#lyricPlayAll').textContent = '■ 止める';
  const lines = lyricLines();
  const step = (i) => {
    $$('.lyric-line.playing').forEach((x) => x.classList.remove('playing'));
    if (!playAllOn || i >= lines.length) return stopPlayAll();
    const row = $(`.lyric-line[data-n="${i}"]`);
    if (row) { row.classList.add('playing'); row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    speak(lines[i], { onend: () => playAllOn && setTimeout(() => step(i + 1), 250) });
  };
  step(0);
});
$('#lyricQuizBtn').addEventListener('click', () => { stopPlayAll(); showView('quiz'); startQuiz('cloze'); });
function lyricTokens() {
  const seen = new Map();
  lyricLines().forEach((l) => (l.match(TOKEN_RE) || []).forEach((t) => { const k = norm(t); if (k.length >= 2 && !seen.has(k)) seen.set(k, plain(t)); }));
  return Array.from(seen.values());
}

/* =========================================================
 * 発音
 * ========================================================= */
let spItems = [];
function buildSpeakSources() {
  const opts = [['letters', '文字の例の単語（33）']]
    .concat(WORD_CATS.map((c) => [c.id, `${c.name}（${WORDS.filter((w) => w.cat === c.id).length}）`]));
  const lines = lyricLines();
  if (lines.length) opts.push(['lyrics', `入力した歌詞（${lines.length} 行）`]);
  const sel = $('#spSource');
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  if (!opts.some(([v]) => v === settings.spSource)) settings.spSource = 'letters';
  sel.value = settings.spSource;
}
function speakItems(src) {
  if (src === 'letters') return LETTERS.map((l) => ({ w: l.ex.w, kana: l.ex.kana, ja: l.ex.ja, note: `${l.up} ${l.lo}：${l.note}` }));
  if (src === 'lyrics') return lyricLines().map((l) => ({ w: l, kana: translit(l), ja: '', note: '' }));
  return WORDS.filter((w) => w.cat === src);
}
function renderSpeak() {
  spItems = speakItems(settings.spSource);
  if (!spItems.length) { settings.spSource = 'letters'; spItems = speakItems('letters'); }
  settings.spIndex = ((settings.spIndex % spItems.length) + spItems.length) % spItems.length;
  const it = spItems[settings.spIndex];
  $('#spPos').textContent = `${settings.spIndex + 1} / ${spItems.length}`;
  $('#spWord').textContent = accent(it.w);
  $('#spWord').classList.toggle('long', plain(it.w).length > 16);
  $('#spKana').textContent = it.kana || '';
  $('#spJa').textContent = it.ja || '';
  $('#spNote').innerHTML = it.note ? accent(it.note) : '';
  $('#spResult').innerHTML = '';
  saveSettings();
}
$('#spSource').addEventListener('change', (e) => { settings.spSource = e.target.value; settings.spIndex = 0; renderSpeak(); });
$('#spPrev').addEventListener('click', () => { settings.spIndex--; renderSpeak(); });
$('#spNext').addEventListener('click', () => { settings.spIndex++; renderSpeak(); });
$('#spPlay').addEventListener('click', () => canSpeak() ? speak(spItems[settings.spIndex].w) : toastNoVoice());
$('#spSlow').addEventListener('click', () => canSpeak() ? speak(spItems[settings.spIndex].w, { rate: 0.5 }) : toastNoVoice());
function micButton(btn, getTarget, out) {
  btn.addEventListener('click', () => {
    const target = getTarget();
    if (!target) return;
    listenRu((alts, err) => { out.innerHTML = judgeSpeech(target, alts || [], err); },
      (on) => { btn.classList.toggle('listening', on); btn.textContent = on ? '● 聞いています…（押すと止める）' : btn.dataset.label; if (on) out.innerHTML = '<p class="sp-score">どうぞ、話してください</p>'; });
  });
  btn.dataset.label = btn.textContent;
}
micButton($('#spMic'), () => spItems[settings.spIndex].w, $('#spResult'));
micButton($('#freeMic'), () => { const t = $('#freeInput').value.trim(); if (!t) return ''; showFreeTarget(t); return t; }, $('#spResult'));
function showFreeTarget(t) {
  $('#spWord').textContent = accent(t); $('#spWord').classList.toggle('long', t.length > 16);
  $('#spKana').textContent = translit(t); $('#spJa').textContent = '（自由入力）'; $('#spNote').innerHTML = ''; $('#spPos').textContent = '';
  $('#spCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#freeInput').addEventListener('input', (e) => { $('#freeLat').textContent = translit(e.target.value); });
$('#freePlay').addEventListener('click', () => { const t = $('#freeInput').value.trim(); if (t) canSpeak() ? speak(t) : toastNoVoice(); });
if (!SR) {
  $('#spMic').disabled = true; $('#freeMic').disabled = true;
  $('#micHint').textContent = 'このブラウザは音声認識に対応していないため、発音チェックは使えません（Chrome・Edge・Safari で使えます）。お手本の読み上げは使えます。';
} else if (!window.isSecureContext) {
  $('#micHint').textContent = 'マイクは https:// か localhost で開いたときだけ使えます。';
}
$('#optVoice').addEventListener('change', (e) => { settings.voice = e.target.value; saveSettings(); speak('Привет'); });
$('#optRate').value = settings.rate;
$('#optRate').addEventListener('change', (e) => { settings.rate = e.target.value; saveSettings(); });
$('#optVolume').value = settings.volume;
$('#optVolume').addEventListener('change', (e) => { settings.volume = e.target.value; saveSettings(); });

/* =========================================================
 * クイズ
 * ========================================================= */
const MODES = [
  { id: 'l2s', group: '文字', icon: 'Б', name: '文字を読む', desc: '文字を見て、音を選ぶ' },
  { id: 's2l', group: '文字', icon: 'ア', name: '音から文字', desc: '音（読み）に合う文字を選ぶ' },
  { id: 'face', group: '文字', icon: '<span class="it">т</span>', name: 'イタリック・筆記体', desc: '形の変わる小文字を見分ける' },
  { id: 'word', group: '単語', icon: 'Аа', name: '単語を読む', desc: 'ロシア語を見て、読みを選ぶ' },
  { id: 'kana', group: '単語', icon: 'カ', name: '読みから単語', desc: '読みと意味から、つづりを選ぶ' },
  { id: 'listen', group: '単語', icon: '♪', name: '聞き取り', desc: '読み上げを聞いて単語を選ぶ', needVoice: true },
  { id: 'type', group: '単語', icon: '⌨', name: '書き取り', desc: '読みと意味を見て、キリル文字で入力' },
  { id: 'stress', group: '文法・発音', icon: 'а́', name: 'アクセントの位置', desc: 'どの母音を強く読むかを選ぶ' },
  { id: 'gender', group: '文法・発音', icon: '♂♀', name: '名詞の性', desc: '男性・女性・中性を見分ける' },
  { id: 'song', group: 'カチューシャ', icon: 'К', name: '歌の単語 → 日本語', desc: '歌に出てくる単語の意味を日本語で選ぶ' },
  { id: 'songJa', group: 'カチューシャ', icon: '和', name: '日本語 → 歌の単語', desc: '日本語の意味から、ロシア語の単語を選ぶ' },
  { id: 'cloze', group: 'カチューシャ', icon: '＿', name: '歌詞の穴埋め', desc: '入力した歌詞の空欄に入る単語を選ぶ', needLyrics: true }
];
function modeAvailable(m) {
  if (m.needVoice && !canSpeak()) return 'ロシア語の読み上げ音声が必要です';
  if (m.needLyrics && lyricTokens().length < 4) return '「カチューシャ」タブで歌詞を入力すると遊べます';
  return '';
}
function renderModes() {
  let g = '', html = '';
  MODES.forEach((m) => {
    if (m.group !== g) { g = m.group; html += `<div class="mode-group">${g}</div>`; }
    const why = modeAvailable(m);
    html += `<button type="button" class="mode" data-mode="${m.id}"${why ? ' disabled' : ''}>
      <span class="mode-icon">${m.icon}</span>
      <span><span class="mode-name">${m.name}</span><span class="mode-desc">${why || m.desc}</span></span></button>`;
  });
  $('#modeList').innerHTML = html;
}
$('#modeList').addEventListener('click', (e) => { const b = e.target.closest('.mode'); if (b && !b.disabled) startQuiz(b.dataset.mode); });

// --- 設定 ---
$('#optCount').value = settings.count;
$('#optKbd').value = settings.kbd;
[['optStress', 'stress'], ['optWeak', 'weak'], ['optAuto', 'auto'], ['optSpeak', 'speak']].forEach(([id, k]) => {
  $('#' + id).checked = settings[k];
  $('#' + id).addEventListener('change', (e) => { settings[k] = e.target.checked; saveSettings(); updateSummary(); });
});
$('#optCount').addEventListener('change', (e) => { settings.count = e.target.value; saveSettings(); updateSummary(); });
$('#optKbd').addEventListener('change', (e) => { settings.kbd = e.target.value; saveSettings(); });
makeChips($('#groupChips'), LETTER_GROUPS.map((g) => [g.id, g.name]), settings.groups, (v) => { settings.groups = v; saveSettings(); updateSummary(); });
makeChips($('#catChips'), WORD_CATS.map((c) => [c.id, c.name]), settings.cats, (v) => { settings.cats = v; saveSettings(); updateSummary(); });
function letterPool() { return LETTERS.filter((l) => settings.groups.includes(l.group)); }
function wordPool() { return WORDS.filter((w) => settings.cats.includes(w.cat)); }
function updateSummary() {
  const n = settings.count === 'all' ? '全部' : settings.count + '問';
  $('#settingsSummary').textContent = `${n}・文字 ${letterPool().length}・単語 ${wordPool().length}`;
  $('#poolHint').textContent = `単語のクイズは ${wordPool().length} 語から出題します。` + WORD_CATS.filter((c) => settings.cats.includes(c.id)).map((c) => `${c.name}：${c.desc}`).join('／');
}

// --- 問題を作る ---
function distractors(all, correct, n, keyFn, prefer) {
  const ck = keyFn(correct);
  const seen = new Set([ck]);
  const out = [];
  const add = (x) => { const k = keyFn(x); if (!seen.has(k)) { seen.add(k); out.push(x); } };
  if (prefer) shuffle(prefer).forEach((x) => out.length < n && add(x));
  shuffle(all).forEach((x) => out.length < n && add(x));
  return out;
}
function choiceSet(correct, others, render) {
  return shuffle([{ correct: true, item: correct }].concat(others.map((o) => ({ correct: false, item: o }))))
    .map((c) => ({ correct: c.correct, html: render(c.item) }));
}
const letterSound = (l) => `${esc(l.kana)}<span class="sub">${esc(l.lat)}</span>`;
const letterExplain = (l) => `<b class="ru">${l.up} ${l.lo}</b>（${accent(l.name)}・${esc(l.nameKana)}）　例 ${R(l.ex.w, l.ex.kana, l.ex.ja)}`;
const wordExplain = (w) => `${R(w.w, w.kana, w.ja)}${w.note ? `<span class="why">${accent(esc(w.note))}</span>` : ''}`;
const CONFUSABLE = 'тшщмлийпнгдбвжзкцчьъыэюя'.split('');

const BUILDERS = {
  l2s(n) {
    return weightedSample(letterPool(), n, letterKey).map((l) => {
      const shown = Math.random() < 0.5 ? l.up : l.lo;
      return {
        key: letterKey(l), prompt: 'この文字の音は？',
        stage: `<span class="big ru">${shown}</span>`,
        choices: choiceSet(l, distractors(LETTERS, l, 3, (x) => x.kana), letterSound),
        explain: letterExplain(l), say: l.ex.w,
        review: [`<span class="ru">${shown}</span>`, `${esc(l.kana)}（${esc(l.lat)}）`]
      };
    });
  },
  s2l(n) {
    return weightedSample(letterPool(), n, letterKey).map((l) => ({
      key: letterKey(l), prompt: 'この音を表す文字は？',
      stage: `<span class="sound">${esc(l.kana)}<small>ラテン文字では ${esc(l.lat)}</small></span>`,
      choices: choiceSet(l, distractors(LETTERS, l, 3, (x) => x.up), (x) => `<span class="ru">${x.up} ${x.lo}</span>`),
      explain: letterExplain(l), say: l.ex.w,
      review: [esc(l.kana), `<span class="ru">${l.up} ${l.lo}</span>`]
    }));
  },
  face(n) {
    return weightedSample(LETTERS.filter((l) => CONFUSABLE.includes(l.lo)), n, letterKey).map((l) => {
      const f = Math.random() < 0.5 ? 'it' : 'script';
      const conf = LETTERS.filter((x) => CONFUSABLE.includes(x.lo));
      return {
        key: letterKey(l), prompt: f === 'it' ? 'イタリック体のこの文字は？' : '筆記体のこの文字は？',
        stage: `<span class="big ru ${f}">${l.lo}</span>`,
        choices: choiceSet(l, distractors(LETTERS, l, 3, (x) => x.lo, conf), (x) => `<span class="ru">${x.lo}</span><span class="sub">${esc(x.lat)}</span>`),
        explain: `ふつうの書体では <b class="ru">${l.lo}</b>　${letterExplain(l)}`, say: l.ex.w,
        review: [`<span class="ru ${f}">${l.lo}</span>`, `<span class="ru">${l.lo}</span>`]
      };
    });
  },
  word(n, pool = wordPool()) {
    return weightedSample(pool, n, wordKey).map((w) => {
      const same = pool.filter((x) => x.cat === w.cat);
      return {
        key: wordKey(w), prompt: 'この言葉の読みは？',
        stage: `<span class="word ru">${showWord(w.w)}</span>`,
        choices: choiceSet(w, distractors(pool, w, 3, (x) => x.kana, same), (x) => `${esc(x.kana)}<span class="sub">${esc(x.ja)}</span>`),
        explain: wordExplain(w), say: w.w,
        review: [`<span class="ru">${showWord(w.w)}</span>`, `${esc(w.kana)}（${esc(w.ja)}）`]
      };
    });
  },
  kana(n, pool = wordPool()) {
    return weightedSample(pool, n, wordKey).map((w) => {
      const same = pool.filter((x) => x.cat === w.cat);
      return {
        key: wordKey(w), prompt: 'この読みのロシア語は？',
        stage: `<span class="sound">${esc(w.kana)}<small>${esc(w.ja)}</small></span>`,
        choices: choiceSet(w, distractors(pool, w, 3, (x) => plain(x.w), same), (x) => `<span class="ru">${showWord(x.w)}</span>`),
        explain: wordExplain(w), say: w.w,
        review: [esc(w.kana), `<span class="ru">${showWord(w.w)}</span>`]
      };
    });
  },
  listen(n, pool = wordPool()) {
    return weightedSample(pool, n, wordKey).map((w) => {
      const same = pool.filter((x) => x.cat === w.cat);
      return {
        key: wordKey(w), prompt: '読み上げた言葉はどれ？', listen: w.w,
        stage: `<button type="button" class="btn listen-btn" data-replay>♪ もう一度聞く</button>`,
        choices: choiceSet(w, distractors(pool, w, 3, (x) => plain(x.w), same), (x) => `<span class="ru">${showWord(x.w)}</span>`),
        explain: wordExplain(w), say: w.w,
        review: ['♪', `<span class="ru">${showWord(w.w)}</span>（${esc(w.ja)}）`]
      };
    });
  },
  type(n, pool = wordPool()) {
    return weightedSample(pool, n, wordKey).map((w) => ({
      key: wordKey(w), prompt: 'キリル文字で書いてみよう', type: plain(w.w),
      stage: `<span class="sound">${esc(w.kana)}<small>${esc(w.ja)}</small></span>`,
      explain: wordExplain(w), say: w.w,
      review: [esc(w.kana), `<span class="ru">${showWord(w.w)}</span>`]
    }));
  },
  stress(n) {
    const pool = WORDS.filter((w) => !/[ ёЁ]/.test(w.w) && w.w.includes('+') && (plain(w.w).match(/[аеиоуыэюя]/gi) || []).length >= 2);
    return weightedSample(pool, n, (w) => 'S:' + plain(w.w)).map((w) => {
      const p = plain(w.w);
      const variants = [];
      Array.from(p).forEach((c, i) => { if (VOWELS.includes(c.toLowerCase())) variants.push(p.slice(0, i + 1) + '+' + p.slice(i + 1)); });
      const correct = variants.find((v) => v === w.w) || w.w;
      const others = shuffle(variants.filter((v) => v !== correct)).slice(0, 3);
      return {
        key: 'S:' + p, prompt: `「${esc(w.ja)}」の正しいアクセントは？`, wide: others.length < 3,
        stage: `<span class="word ru">${p}</span>`,
        choices: choiceSet(correct, others, (v) => `<span class="ru">${accent(v)}</span>`),
        explain: wordExplain(w), say: w.w,
        review: [`<span class="ru">${p}</span>`, `<span class="ru">${accent(w.w)}</span>（${esc(w.kana)}）`]
      };
    });
  },
  gender(n) {
    let pool = wordPool().filter((w) => w.g);
    if (pool.length < 8) pool = WORDS.filter((w) => w.g);
    return weightedSample(pool, n, (w) => 'G:' + plain(w.w)).map((w) => ({
      key: 'G:' + plain(w.w), prompt: 'この名詞の性は？', wide: false, three: true,
      stage: `<span class="word ru">${showWord(w.w)}</span><span class="hint">${esc(w.ja)}</span>`,
      choices: ['m', 'f', 'n'].map((g) => ({ correct: g === w.g, html: `${GENDER_NAMES[g]}<span class="sub">${g === 'm' ? 'он' : g === 'f' ? 'она' : 'оно'}</span>` })),
      explain: `${R(w.w, w.kana, w.ja)}は<b>${GENDER_NAMES[w.g]}名詞</b><span class="why">${esc(w.gnote || genderRule(w))}</span>`, say: w.w,
      review: [`<span class="ru">${showWord(w.w)}</span>`, GENDER_NAMES[w.g]]
    }));
  },
  // カチューシャの単語の日本語クイズ（ロシア語 → 意味）
  song(n) {
    return weightedSample(SONG_WORDS, n, wordKey).map((w) => ({
      key: wordKey(w), prompt: 'この言葉の意味は？',
      stage: `<span class="word ru">${showWord(w.w)}</span>`,
      choices: choiceSet(w, distractors(SONG_WORDS, w, 3, (x) => x.ja), (x) => esc(x.ja)),
      explain: wordExplain(w), say: w.w,
      review: [`<span class="ru">${showWord(w.w)}</span>`, `${esc(w.ja)}（${esc(w.kana)}）`]
    }));
  },
  // 意味 → ロシア語
  songJa(n) {
    return weightedSample(SONG_WORDS, n, wordKey).map((w) => ({
      key: wordKey(w), prompt: 'この意味のロシア語は？',
      stage: `<span class="sound">${esc(w.ja)}</span>`,
      choices: choiceSet(w, distractors(SONG_WORDS, w, 3, (x) => plain(x.w)), (x) => `<span class="ru">${showWord(x.w)}</span>`),
      explain: wordExplain(w), say: w.w,
      review: [esc(w.ja), `<span class="ru">${showWord(w.w)}</span>（${esc(w.kana)}）`]
    }));
  },
  cloze(n) {
    const lines = lyricLines();
    const tokens = lyricTokens();
    const cands = [];
    lines.forEach((l, li) => (l.match(TOKEN_RE) || []).forEach((t, ti) => { if (plain(t).length >= 3) cands.push({ li, ti, t }); }));
    return shuffle(cands).slice(0, n).map(({ li, ti, t }) => {
      const line = lines[li];
      let k = -1;
      const shown = esc(line).replace(TOKEN_RE, (x) => (++k === ti ? '<span class="blank">？</span>' : accent(x)));
      const ans = plain(t);
      const pref = tokens.filter((x) => Math.abs(x.length - ans.length) <= 2);
      const others = distractors(tokens, ans, 3, (x) => norm(x), pref);
      return {
        key: 'C:' + norm(ans), prompt: '空欄に入る言葉は？',
        stage: `<span class="line ru">${shown}</span>`,
        choices: choiceSet(ans, others, (x) => `<span class="ru">${esc(x)}</span>`),
        explain: `<span class="ru">${accent(esc(line))}</span><span class="why">${esc(translit(line))}</span>`, say: line,
        review: [`<span class="ru">${shown}</span>`, `<span class="ru">${esc(ans)}</span>`]
      };
    });
  }
};
function genderRule(w) {
  const e = plain(w.w).slice(-1).toLowerCase();
  if (e === 'ь') return '-ь で終わる名詞は男性・女性どちらもあるので、1 語ずつ覚えます';
  if ('ая'.includes(e)) return '-а／-я で終わるので女性';
  if ('ое'.includes(e)) return '-о／-е で終わるので中性';
  return '子音（または -й）で終わるので男性';
}

// --- 進行 ---
let Q = null; // { mode, list, i, score, answered, results, typed }
function startQuiz(mode, list) {
  if (synth) synth.cancel();
  const n = settings.count === 'all' ? 999 : +settings.count;
  const qs = list || BUILDERS[mode](n);
  if (!qs.length) { alert('出題できる問題がありません。設定の範囲を見直してください。'); return; }
  Q = { mode, list: qs, i: 0, score: 0, results: [] };
  $('#quizSetup').hidden = true; $('#quizResult').hidden = true; $('#quizPlay').hidden = false;
  document.body.classList.add('playing');
  renderQuestion();
}
function renderQuestion() {
  const q = Q.list[Q.i];
  Q.answered = false; Q.typed = '';
  $('#progressLabel').textContent = `${Q.i + 1} / ${Q.list.length}`;
  $('#scoreLabel').textContent = `${Q.score} 正解`;
  $('#progressBar').style.width = (Q.i / Q.list.length * 100) + '%';
  $('#prompt').innerHTML = q.prompt;
  $('#stage').innerHTML = q.stage;
  $('#stage').classList.remove('tappable');
  $('#gloss').innerHTML = '';
  $('#nextBtn').hidden = true;
  $('#replayBtn').hidden = !q.listen && !(q.type && canSpeak());
  $('#replayBtn').textContent = q.listen ? 'もう一度聞く' : '♪ ヒントを聞く';
  const typing = !!q.type;
  $('#typing').hidden = !typing;
  $('#choices').hidden = typing;
  if (typing) { renderKbd(); renderTyped(); }
  else {
    $('#choices').className = 'choices' + (q.wide ? ' wide' : '');
    $('#choices').style.gridTemplateColumns = q.three ? 'repeat(3, 1fr)' : '';
    $('#choices').innerHTML = q.choices.map((c, i) => `<button type="button" class="choice" data-i="${i}">${c.html}</button>`).join('');
  }
  if (q.listen) setTimeout(() => speak(q.listen), 250);
}
$('#choices').addEventListener('click', (e) => {
  const b = e.target.closest('.choice'); if (!b || Q.answered) return;
  const q = Q.list[Q.i];
  const ok = q.choices[+b.dataset.i].correct;
  $$('.choice', $('#choices')).forEach((x, i) => { x.disabled = true; if (q.choices[i].correct) x.classList.add('correct'); });
  if (!ok) b.classList.add('wrong');
  finishAnswer(ok);
});
function finishAnswer(ok) {
  const q = Q.list[Q.i];
  Q.answered = true;
  if (ok) Q.score++;
  record(q.key, ok);
  Q.results.push({ q, ok });
  $('#scoreLabel').textContent = `${Q.score} 正解`;
  $('#gloss').innerHTML = `<span class="${ok ? 'ok' : 'ng'}">${ok ? '正解！' : '残念…'}</span>　${q.explain}`;
  if (settings.speak && q.say && canSpeak()) speak(q.say);
  $('#nextBtn').hidden = false;
  $('#nextBtn').textContent = Q.i + 1 < Q.list.length ? '次へ' : '結果を見る';
  $('#stage').classList.add('tappable');
  if (ok && settings.auto) setTimeout(() => { if (Q && Q.answered && Q.list[Q.i] === q) nextQuestion(); }, 1100);
  else $('#nextBtn').focus({ preventScroll: true });
}
function nextQuestion() {
  if (!Q) return;
  if (Q.i + 1 < Q.list.length) { Q.i++; renderQuestion(); } else showResult();
}
$('#nextBtn').addEventListener('click', nextQuestion);
$('#stage').addEventListener('click', (e) => {
  if (e.target.closest('[data-replay]')) { speak(Q.list[Q.i].listen); return; }
  if (Q && Q.answered && !e.target.closest('[data-say]')) nextQuestion();
});
$('#replayBtn').addEventListener('click', () => { const q = Q.list[Q.i]; speak(q.listen || q.say); });
$('#quitBtn').addEventListener('click', backToSetup);
function backToSetup() {
  Q = null; if (synth) synth.cancel();
  document.body.classList.remove('playing');
  $('#quizPlay').hidden = true; $('#quizResult').hidden = true; $('#quizSetup').hidden = false;
  renderModes(); renderLetters();
}
function showResult() {
  $('#quizPlay').hidden = true; $('#quizResult').hidden = false;
  document.body.classList.remove('playing');
  const total = Q.list.length, r = Q.score / total;
  $('#resultScore').textContent = Q.score;
  $('#resultTotal').textContent = ` / ${total}`;
  $('#resultTitle').innerHTML = r === 1 ? '<span class="ru">Отли+чно!</span>'.replace('+', '́') + '　全問正解です' : r >= 0.8 ? '<span class="ru">Хорошо!</span>　よくできました' : r >= 0.5 ? 'もう少し！ 間違えた問題を見直しましょう' : '少しずつ慣れていきましょう';
  const missed = Q.results.filter((x) => !x.ok).map((x) => x.q);
  $('#retryMissBtn').hidden = !missed.length;
  $('#review').innerHTML = Q.results.map(({ q, ok }) => `<div class="review-item ${ok ? 'ok' : 'ng'}">
    <span class="mark">${ok ? '○' : '×'}</span><span class="q">${q.review[0]}</span><span class="a">${q.review[1]}</span>
    ${q.say ? `<button type="button" class="say-btn" data-say="${esc(plain(q.say))}" aria-label="読み上げ">♪</button>` : ''}</div>`).join('');
  window.scrollTo(0, 0);
}
$('#againBtn').addEventListener('click', () => startQuiz(Q.mode));
$('#retryMissBtn').addEventListener('click', () => {
  const missed = Q.results.filter((x) => !x.ok).map((x) => x.q);
  missed.forEach((q) => { if (q.choices) q.choices = shuffle(q.choices); });
  startQuiz(Q.mode, shuffle(missed));
});
$('#backBtn').addEventListener('click', backToSetup);

// --- 書き取りのキーボード ---
const KBD_ABC = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'.split('');
const KBD_JCUKEN = ['йцукенгшщзх', 'фывапролджэ', 'ячсмитьбюъё'];
function renderKbd() {
  const k = $('#kbd');
  const key = (c) => `<button type="button" class="key" data-k="${c}">${c}</button>`;
  if (settings.kbd === 'jcuken') {
    k.className = 'kbd';
    k.innerHTML = KBD_JCUKEN.join('').split('').map(key).join('') +
      '<button type="button" class="key fn wide2" data-k="⌫">⌫</button><button type="button" class="key fn wide3" data-k=" ">空白</button>' +
      '<button type="button" class="key fn wide2" data-k="clear">消す</button><button type="button" class="key fn ok wide3" data-k="ok">答える</button>';
  } else {
    k.className = 'kbd abc';
    k.innerHTML = KBD_ABC.map(key).join('') + '<button type="button" class="key fn" data-k=" ">空白</button><button type="button" class="key fn" data-k="⌫">⌫</button><button type="button" class="key fn ok" data-k="ok">答える</button>';
  }
}
function renderTyped(state) {
  const d = $('#typeDisplay');
  d.className = 'type-display ru' + (state ? ' ' + state : '');
  d.innerHTML = esc(Q.typed) + (Q.answered ? '' : '<span class="caret"></span>');
}
function typeKey(k) {
  if (!Q || Q.answered || !Q.list[Q.i].type) return;
  if (k === '⌫') Q.typed = Q.typed.slice(0, -1);
  else if (k === 'clear') Q.typed = '';
  else if (k === 'ok') return checkTyped();
  else Q.typed += k;
  renderTyped();
}
function checkTyped() {
  const q = Q.list[Q.i];
  if (!Q.typed.trim()) return;
  const ok = norm(Q.typed) === norm(q.type);
  renderTyped(ok ? 'correct' : 'wrong');
  if (!ok) $('#typeDisplay').innerHTML += `<div class="hint">正解：<span class="ru">${esc(q.type)}</span></div>`;
  finishAnswer(ok);
}
$('#kbd').addEventListener('click', (e) => { const b = e.target.closest('.key'); if (b) typeKey(b.dataset.k); });
document.addEventListener('keydown', (e) => {
  if (!Q || $('#quizPlay').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.matches('input, textarea, select')) return;
  const q = Q.list[Q.i];
  if (Q.answered) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nextQuestion(); } return; }
  if (q.type) {
    if (/^[а-яё ]$/i.test(e.key)) { e.preventDefault(); typeKey(e.key.toLowerCase()); }
    else if (e.key === 'Backspace') { e.preventDefault(); typeKey('⌫'); }
    else if (e.key === 'Enter') { e.preventDefault(); typeKey('ok'); }
  } else if (/^[1-4]$/.test(e.key)) {
    const b = $$('.choice', $('#choices'))[+e.key - 1]; if (b) b.click();
  }
});

/* =========================================================
 * 説明・インストール
 * ========================================================= */
$('#resetStats').addEventListener('click', () => {
  if (!confirm('クイズの正答率の記録を消しますか？')) return;
  stats = {}; store.set('stats', stats); renderLetters();
});
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBtn').hidden = true; });
if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/* =========================================================
 * 起動
 * ========================================================= */
renderLetters();
renderGuide();
renderSong();
renderLyrics();
buildSpeakSources();
updateSummary();
loadVoices();
if (synth) synth.addEventListener ? synth.addEventListener('voiceschanged', loadVoices) : (synth.onvoiceschanged = loadVoices);
showView(settings.view);
