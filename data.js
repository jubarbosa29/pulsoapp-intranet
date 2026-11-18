// Funções de dados da intranet. Compartilhadas por app.js e por tools/verify-local.mjs.
export const BUCKET = 'exercise-images';
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_SIDE = 1200;
export const WEBP_QUALITY = 0.8;
export const KIND_LABELS = { maquina: 'Máquina', 'peso-livre': 'Peso livre', funcional: 'Funcional' };

export const isAdmin = (session) => session?.user?.app_metadata?.role === 'admin';

export function imagePathFor(code) {
  return `${code}.webp`;
}

export function publicImageUrl(supabaseUrl, path, version) {
  if (!path) return null;
  const base = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;
  return version ? `${base}?v=${version}` : base;
}

export async function fetchExercises(client) {
  const { data, error } = await client
    .from('exercises')
    .select('code,name,kind,step_kinds,priority,muscles,how_to,image_path,active,created_at')
    .eq('active', true)
    .order('priority', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchExercise(client, code) {
  const { data, error } = await client
    .from('exercises')
    .select('code,name,kind,step_kinds,priority,muscles,how_to,image_path,active,created_at')
    .eq('code', code)
    .single();
  if (error) throw error;
  return data;
}

/** Sobe o blob webp com upsert e grava image_path. Lança em caso de erro ou de falta de permissão. */
export async function uploadExerciseImage(client, code, blob) {
  const path = imagePathFor(code);
  const up = await client.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    contentType: 'image/webp',
    cacheControl: '3600',
  });
  if (up.error) throw up.error;
  const upd = await client.from('exercises').update({ image_path: path }).eq('code', code).select('code');
  if (upd.error) throw upd.error;
  if (!upd.data || upd.data.length !== 1) throw new Error('Sem permissão para gravar o caminho da imagem.');
  return path;
}

export function friendlyUploadError(err) {
  const msg = String(err?.message ?? err ?? '');
  if (/row-level security|unauthorized|not authorized|permission|403/i.test(msg)) {
    return 'Sem permissão para enviar imagens com esta conta.';
  }
  if (/network|failed to fetch/i.test(msg)) return 'Falha de conexão. Tente de novo.';
  return 'Não foi possível enviar a imagem. Tente de novo.';
}
