# Intranet do Pulso (intranet.pulsoapp.me)

Página estática para subir as imagens do catálogo de exercícios. Sem build, sem npm: ES modules e `@supabase/supabase-js` por CDN (versão fixa).

- Login por e-mail com código de 6 dígitos. Só contas com `app_metadata.role = 'admin'` editam; as demais veem o catálogo e o aviso "Sem permissão para editar".
- `config.js` tem só a URL e a chave publishable do Supabase (públicas por design). Nenhum segredo neste repositório.
- `exercise-prompts.json` é cópia do app: rode `npm run intranet:sync` na pasta do app.
- Teste local: copie a URL e a chave locais para `config.local.js` (ignorado pelo git) e abra `index.html?env=local` por um servidor estático (ex.: `python3 -m http.server`).
- Verificação contra o Supabase local: `tools/verify-local.mjs` (instruções no cabeçalho do arquivo).
- Publicação: GitHub Pages com o domínio do arquivo `CNAME`.
