// Verificação contra o Supabase LOCAL: roda as mesmas funções de data.js que o app.js usa.
// Uso (na pasta do app, onde @supabase/supabase-js está instalado):
//   set -a; eval "$(npx supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"; set +a
//   node <caminho>/tools/verify-local.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(process.env.SUPABASE_JS_FROM ?? `${process.cwd()}/package.json`);
const { createClient } = require('@supabase/supabase-js');
const { fetchExercises, fetchExercise, uploadExerciseImage, publicImageUrl, isAdmin, BUCKET } =
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

  let failedN = false;
  try { await uploadExerciseImage(normal.client, code, webp(1)); } catch { failedN = true; }
  check('comum: uploadExerciseImage falha', failedN);
  check('comum: image_path inalterado', (await fetchExercise(normal.client, code)).image_path === originalPath);

  const p1 = await uploadExerciseImage(adm.client, code, webp(1));
  check('admin: upload 1 retorna <code>.webp', p1 === `${code}.webp`);
  check('admin: image_path gravado', (await fetchExercise(adm.client, code)).image_path === `${code}.webp`);
  const url = publicImageUrl(API_URL, p1, Date.now());
  const r1 = await fetch(url);
  const len1 = (await r1.arrayBuffer()).byteLength;
  check('imagem publica acessivel (sem login)', r1.ok);

  const p2 = await uploadExerciseImage(adm.client, code, webp(2));
  const r2 = await fetch(publicImageUrl(API_URL, p2, Date.now() + 1));
  const len2 = (await r2.arrayBuffer()).byteLength;
  check('admin: segundo upload substitui (upsert)', p2 === p1 && r2.ok && len2 === len1 + 1);
  const listing = await svc.storage.from(BUCKET).list('', { search: code });
  check('somente 1 objeto para o codigo', listing.data?.filter((o) => o.name === `${code}.webp`).length === 1);
} finally {
  await svc.storage.from(BUCKET).remove([`${code}.webp`]);
  await svc.from('exercises').update({ image_path: originalPath ?? null }).eq('code', code);
  await svc.auth.admin.deleteUser(adm.id);
  await svc.auth.admin.deleteUser(normal.id);
}
console.log(failures ? `${failures} FALHA(S)` : 'TUDO OK');
process.exit(failures ? 1 : 0);
