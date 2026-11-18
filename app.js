import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import {
  KIND_LABELS, MAX_FILE_BYTES, MAX_SIDE, WEBP_QUALITY,
  isAdmin, fetchExercises, fetchExercise, publicImageUrl, uploadExerciseImage, friendlyUploadError,
} from './data.js';

const $ = (id) => document.getElementById(id);

async function loadConfig() {
  if (new URLSearchParams(location.search).get('env') === 'local') {
    try { return await import('./config.local.js'); } catch { /* cai no config de produção */ }
  }
  return import('./config.js');
}
const cfg = await loadConfig();
const SUPABASE_URL = cfg.SUPABASE_URL;
const client = createClient(SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
const promptsData = await fetch('exercise-prompts.json').then((r) => r.json()).catch(() => ({ prompts: {} }));

const state = { exercises: [], admin: false, prio: 'all', onlyMissing: false, versions: {} };

function show(loggedIn) {
  $('login').hidden = loggedIn;
  $('app').hidden = !loggedIn;
}

// ---- login ----
let pendingEmail = '';
$('email-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  pendingEmail = $('email').value.trim();
  $('send-code').disabled = true;
  const { error } = await client.auth.signInWithOtp({ email: pendingEmail, options: { shouldCreateUser: false } });
  $('send-code').disabled = false;
  if (error) { $('login-error').textContent = 'Não conseguimos enviar o código. Confira o e-mail e tente de novo.'; return; }
  $('login-title').textContent = 'Digite o código';
  $('login-help').textContent = 'Enviamos um código de 6 dígitos para o seu e-mail.';
  $('email-form').hidden = true;
  $('code-form').hidden = false;
  $('code').focus();
});
$('code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  $('verify').disabled = true;
  const { error } = await client.auth.verifyOtp({ email: pendingEmail, token: $('code').value.trim(), type: 'email' });
  $('verify').disabled = false;
  if (error) $('login-error').textContent = 'Código inválido ou expirado.';
});
$('back').addEventListener('click', () => {
  $('code-form').hidden = true;
  $('email-form').hidden = false;
  $('login-title').textContent = 'Entrar na intranet do Pulso';
  $('login-help').textContent = 'Informe seu e-mail para receber um código de 6 dígitos.';
  $('login-error').textContent = '';
});
$('logout').addEventListener('click', () => client.auth.signOut());

client.auth.onAuthStateChange((_event, session) => {
  // Evita deadlock do supabase-js: trabalho assíncrono fora do callback.
  setTimeout(() => onSession(session), 0);
});

async function onSession(session) {
  if (!session) { show(false); $('grid').replaceChildren(); return; }
  show(true);
  state.admin = isAdmin(session);
  $('who').textContent = session.user.email ?? '';
  $('no-permission').hidden = state.admin;
  $('usage-text').textContent = promptsData.usage ?? '';
  $('usage').hidden = !promptsData.usage;
  $('load-error').textContent = '';
  try {
    state.exercises = await fetchExercises(client);
  } catch {
    $('load-error').textContent = 'Não foi possível carregar o catálogo. Recarregue a página.';
    return;
  }
  render();
}

// ---- filtros ----
const PRIOS = [['all', 'Todas'], [1, 'P1'], [2, 'P2'], [3, 'P3']];
for (const [value, label] of PRIOS) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'chip'; b.textContent = label;
  b.setAttribute('aria-pressed', String(value === state.prio));
  b.addEventListener('click', () => {
    state.prio = value;
    for (const c of $('prio-chips').children) c.setAttribute('aria-pressed', String(c === b));
    render();
  });
  $('prio-chips').append(b);
}
$('only-missing').addEventListener('change', (e) => { state.onlyMissing = e.target.checked; render(); });

function updateCounter() {
  const withImg = state.exercises.filter((x) => x.image_path).length;
  $('counter').textContent = `${withImg} de ${state.exercises.length} com imagem`;
}

function render() {
  updateCounter();
  const list = state.exercises.filter((x) =>
    (state.prio === 'all' || x.priority === state.prio) && (!state.onlyMissing || !x.image_path));
  const grid = $('grid');
  grid.replaceChildren(...list.map(buildCard));
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'empty'; p.textContent = 'Nenhum exercício neste filtro.';
    grid.append(p);
  }
}

// ---- card ----
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fillThumb(thumb, ex) {
  thumb.replaceChildren();
  const url = publicImageUrl(SUPABASE_URL, ex.image_path, state.versions[ex.code]);
  if (url) {
    const img = document.createElement('img');
    img.src = url; img.alt = ex.name; img.loading = 'lazy';
    thumb.append(img);
  } else {
    thumb.textContent = 'Sem imagem';
  }
}

function buildCard(ex) {
  const card = el('article', 'card');
  card.dataset.code = ex.code;
  const thumb = el('div', 'thumb');
  fillThumb(thumb, ex);
  const body = el('div', 'card-body');
  body.append(el('h2', null, ex.name));
  const meta = el('div', 'meta');
  meta.append(el('span', 'kind', KIND_LABELS[ex.kind] ?? ex.kind), el('span', 'prio', `P${ex.priority}`));
  for (const m of ex.muscles ?? []) meta.append(el('span', 'tag', m));
  body.append(meta);

  if (ex.how_to?.length) {
    const d = el('details', 'how');
    d.append(el('summary', null, 'Como executar'));
    const ol = el('ol');
    for (const s of ex.how_to) ol.append(el('li', null, s));
    d.append(ol);
    body.append(d);
  }

  const actions = el('div', 'actions');
  const copy = el('button', 'btn secondary small', 'Copiar prompt');
  copy.type = 'button';
  copy.addEventListener('click', () => copyPrompt(ex, copy));
  actions.append(copy);

  const status = el('p', 'status');
  status.setAttribute('role', 'status');
  if (state.admin) {
    const drop = el('label', 'drop');
    drop.append(document.createTextNode(ex.image_path ? 'Arraste outra imagem aqui ou clique para trocar' : 'Arraste a imagem aqui ou clique para escolher'));
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
    input.setAttribute('aria-label', `Escolher imagem de ${ex.name}`);
    drop.append(input);
    input.addEventListener('change', () => { if (input.files[0]) handleFile(ex, input.files[0], card, status); input.value = ''; });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('over');
      const f = e.dataTransfer?.files?.[0];
      if (f) handleFile(ex, f, card, status);
    });
    actions.append(drop);
  }
  actions.append(status);
  body.append(actions);
  card.append(thumb, body);
  return card;
}

async function copyPrompt(ex, btn) {
  const text = promptsData.prompts?.[ex.code];
  if (!text) { btn.textContent = 'Sem prompt'; return; }
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copiado';
  } catch {
    btn.textContent = 'Não foi possível copiar';
  }
  setTimeout(() => { btn.textContent = 'Copiar prompt'; }, 2000);
}

// ---- upload ----
function toWebp(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('webp'))), 'image/webp', WEBP_QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

function setStatus(node, text, kind) {
  node.textContent = text;
  node.className = `status ${kind ?? ''}`;
}

async function handleFile(ex, file, card, status) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    return setStatus(status, 'Formato não aceito. Use PNG, JPG ou WebP.', 'err');
  }
  if (file.size > MAX_FILE_BYTES) {
    return setStatus(status, 'Arquivo maior que 15 MB.', 'err');
  }
  setStatus(status, 'Convertendo e enviando...');
  try {
    const blob = await toWebp(file);
    await uploadExerciseImage(client, ex.code, blob);
    state.versions[ex.code] = Date.now();
    const fresh = await fetchExercise(client, ex.code);
    const idx = state.exercises.findIndex((x) => x.code === ex.code);
    if (idx >= 0) state.exercises[idx] = fresh;
    updateCounter();
    fillThumb(card.querySelector('.thumb'), fresh);
    setStatus(status, 'Imagem salva.', 'ok');
  } catch (err) {
    setStatus(status, err?.message === 'decode' ? 'Não foi possível ler a imagem.' : friendlyUploadError(err), 'err');
  }
}

const { data: { session } } = await client.auth.getSession();
if (!session) show(false);
