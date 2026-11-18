// Funções de dados da intranet. Compartilhadas por app.js e por tools/verify-local.mjs.
export const BUCKET = 'exercise-images';
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_SIDE = 1200;
export const WEBP_QUALITY = 0.8;
export const KIND_LABELS = { maquina: 'Máquina', 'peso-livre': 'Peso livre', funcional: 'Funcional' };

export const isAdmin = (session) => session?.user?.app_metadata?.role === 'admin';

/**
 * Caminho versionado: cada envio gera um objeto novo. O app guarda a imagem em disco pela URL, então trocar o
 * arquivo no mesmo caminho nunca chegaria a quem já baixou a anterior.
 */
export function imagePathFor(code, version = Date.now()) {
  return `${code}-${version}.webp`;
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

export const NOT_WEBP_MESSAGE = 'Este navegador não converte para WebP. Use o Chrome para subir a imagem.';

/** Recusa (sem chamar o Supabase) qualquer blob que não seja WebP, p.ex. o PNG que o Safari devolve no toBlob. */
export function assertWebp(blob) {
  if (!blob || blob.type !== 'image/webp') {
    const e = new Error(NOT_WEBP_MESSAGE);
    e.code = 'NOT_WEBP';
    throw e;
  }
}

/**
 * Sobe o blob webp num caminho versionado, grava image_path e tenta apagar o objeto anterior.
 * Lança em caso de erro ou de falta de permissão no envio ou na gravação do caminho. A remoção do anterior é
 * só limpeza: falha (ou falta de policy de delete no bucket) é ignorada e o objeto antigo fica no bucket.
 */
export async function uploadExerciseImage(client, code, blob) {
  assertWebp(blob);
  const prev = await client.from('exercises').select('image_path').eq('code', code).maybeSingle();
  const previousPath = prev.error ? null : (prev.data?.image_path ?? null);
  const path = imagePathFor(code);
  const up = await client.storage.from(BUCKET).upload(path, blob, {
    upsert: false,
    contentType: blob.type,
    cacheControl: '3600',
  });
  if (up.error) throw up.error;
  const upd = await client.from('exercises').update({ image_path: path }).eq('code', code).select('code');
  if (upd.error) throw upd.error;
  if (!upd.data || upd.data.length !== 1) throw new Error('Sem permissão para gravar o caminho da imagem.');
  if (previousPath && previousPath !== path) {
    try {
      await client.storage.from(BUCKET).remove([previousPath]);
    } catch {
      // limpeza opcional
    }
  }
  return path;
}

export function friendlyUploadError(err) {
  if (err?.code === 'NOT_WEBP') return NOT_WEBP_MESSAGE;
  const msg = String(err?.message ?? err ?? '');
  if (/row-level security|unauthorized|not authorized|permission|403/i.test(msg)) {
    return 'Sem permissão para enviar imagens com esta conta.';
  }
  if (/network|failed to fetch/i.test(msg)) return 'Falha de conexão. Tente de novo.';
  return 'Não foi possível enviar a imagem. Tente de novo.';
}
