// Verificação contra o Supabase LOCAL: roda as mesmas funções de data.js que o app.js usa.
// Uso (na pasta do app, onde @supabase/supabase-js está instalado):
//   set -a; eval "$(npx supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"; set +a
//   node <caminho>/tools/verify-local.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(process.env.SUPABASE_JS_FROM ?? `${process.cwd()}/package.json`);
const { createClient } = require('@supabase/supabase-js');
const { assertWebp, friendlyUploadError, NOT_WEBP_MESSAGE, fetchExercises, fetchExercise, uploadExerciseImage, publicImageUrl, isAdmin, BUCKET } =
  await import(fileURLToPath(new URL('../data.js', import.meta.url)));

const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = process.env;
if (!API_URL?.startsWith('http://127.0.0.1') || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error('Somente Supabase local: defina API_URL (127.0.0.1), ANON_KEY e SERVICE_ROLE_KEY.');
  process.exit(2);
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(API_URL, SERVICE_ROLE_KEY, opts);
const stamp = Date.now();
const password = `t-${stamp}-Aa1!`;
let failures = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures += 1; };

async function makeUser(tag, appMetadata) {
  const email = `intranet-${tag}-${stamp}@example.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, ...(appMetadata ? { app_metadata: appMetadata } : {}) });
  if (error) throw error;
  const client = createClient(API_URL, ANON_KEY, opts);
  const { data: s, error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, client, session: s.session };
}

// webp mínimo válido (1x1)
const webp = (n) => new Blob([Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'), Buffer.alloc(n)], { type: 'image/webp' });
const adm = await makeUser('admin', { role: 'admin' });
const normal = await makeUser('user');
const code = 'bicicleta-ergometrica';
let originalPath;
try {
  const { data: orig } = await svc.from('exercises').select('image_path').eq('code', code).single();
  originalPath = orig.image_path;

  check('isAdmin: admin true, comum false', isAdmin(adm.session) && !isAdmin(normal.session));
  const listN = await fetchExercises(normal.client);
  check(`comum: fetchExercises retorna catalogo (${listN.length})`, listN.length > 100);
  const listA = await fetchExercises(adm.client);
  check('admin: fetchExercises retorna catalogo', listA.length === listN.length);

  // guarda de WebP: blob PNG e recusado antes de qualquer chamada ao Supabase
  let calls = 0;
  const spy = { storage: { from: () => { calls++; throw new Error('chamou storage'); } }, from: () => { calls++; throw new Error('chamou from'); } };
  let guardErr;
  try { await uploadExerciseImage(spy, code, new Blob([Buffer.from([1, 2, 3])], { type: 'image/png' })); } catch (e) { guardErr = e; }
  check('blob nao-webp recusado antes de qualquer upload', guardErr?.code === 'NOT_WEBP' && calls === 0);
  check('mensagem em portugues para nao-webp', friendlyUploadError(guardErr) === NOT_WEBP_MESSAGE && /Chrome/.test(NOT_WEBP_MESSAGE));
  let ok = true; try { assertWebp(webp(1)); } catch { ok = false; }
  check('blob webp passa na guarda', ok);

  let failedN = false;
  try { await uploadExerciseImage(normal.client, code, webp(1)); } catch { failedN = true; }
  check('comum: uploadExerciseImage falha', failedN);
  check('comum: image_path inalterado', (await fetchExercise(normal.client, code)).image_path === originalPath);

  const versioned = (p) => new RegExp(`^${code}-\\d+\\.webp$`).test(p ?? '');
  const p1 = await uploadExerciseImage(adm.client, code, webp(1));
  check('admin: upload 1 retorna <code>-<timestamp>.webp', versioned(p1));
  check('admin: image_path gravado', (await fetchExercise(adm.client, code)).image_path === p1);
  const r1 = await fetch(publicImageUrl(API_URL, p1));
  const len1 = (await r1.arrayBuffer()).byteLength;
  check('imagem publica acessivel (sem login)', r1.ok);

  await new Promise((r) => setTimeout(r, 5)); // timestamps distintos
  const p2 = await uploadExerciseImage(adm.client, code, webp(2));
  check('admin: segundo upload gera caminho novo (URL nova para o cache do app)', versioned(p2) && p2 !== p1);
  check('admin: image_path aponta para o caminho novo', (await fetchExercise(adm.client, code)).image_path === p2);
  const r2 = await fetch(publicImageUrl(API_URL, p2));
  const len2 = (await r2.arrayBuffer()).byteLength;
  check('imagem nova publica e com o conteudo novo', r2.ok && len2 === len1 + 1);
  const listing = await svc.storage.from(BUCKET).list('', { search: code });
  const names = (listing.data ?? []).map((o) => o.name);
  check('objeto novo existe no bucket', names.includes(p2));
  // Sem policy de delete para authenticated: a remocao do anterior e ignorada e ele fica no bucket.
  console.log(`INFO  objeto anterior ${names.includes(p1) ? 'mantido (sem permissao de delete)' : 'removido'}`);

  // remocao do anterior: chamada com o caminho antigo; erro na remocao nao derruba o envio
  const removed = [];
  const fake = (removeImpl) => ({
    from: () => {
      const q = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: { image_path: 'antigo-1.webp' }, error: null }),
        update: () => ({ eq: () => ({ select: async () => ({ data: [{ code }], error: null }) }) }),
      };
      return q;
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: removeImpl }) },
  });
  const pf = await uploadExerciseImage(fake(async (paths) => { removed.push(...paths); return { data: [], error: null }; }), code, webp(1));
  check('remove o objeto anterior depois de gravar o caminho novo', removed.length === 1 && removed[0] === 'antigo-1.webp' && versioned(pf));
  let threw = false;
  try { await uploadExerciseImage(fake(async () => { throw new Error('sem delete'); }), code, webp(1)); } catch { threw = true; }
  check('falha ao remover o anterior e ignorada', !threw);
} finally {
  const left = await svc.storage.from(BUCKET).list('', { search: code });
  const mine = (left.data ?? []).map((o) => o.name).filter((n) => n === `${code}.webp` || n.startsWith(`${code}-`));
  if (mine.length) await svc.storage.from(BUCKET).remove(mine);
  await svc.from('exercises').update({ image_path: originalPath ?? null }).eq('code', code);
  await svc.auth.admin.deleteUser(adm.id);
  await svc.auth.admin.deleteUser(normal.id);
}
console.log(failures ? `${failures} FALHA(S)` : 'TUDO OK');
process.exit(failures ? 1 : 0);
