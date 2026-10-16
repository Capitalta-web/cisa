# Editor en vivo (textos) — Grupo CISA

Permite que personas autorizadas editen títulos, párrafos, listas y botones **directamente sobre la página publicada**. Cada envío abre un **Pull Request** en `abalderasdev/cisa`. Vercel genera la vista previa y **nada se publica sin el merge** de Alberto.

## Cómo funciona

1. Cada texto editable tiene `data-edit="<id estable>"`, p. ej. `index.hero.p-1`. Los del menú (`header.site-header`) y del pie (`footer.footer`) usan ids `global.header.*` / `global.footer.*`, y un cambio ahí se aplica en **todas** las páginas que tengan ese id.
   - Los marca `node scripts/mark_editable.js`. Es idempotente: los ids existentes no cambian y al volver a correrlo solo se marcan los textos nuevos. `--check` solo reporta.
   - Solo se marcan los elementos cuyo contenido es texto con formato simple (`b/strong/i/em/br`, `<a href>`, `<span class>`). Los que llevan iconos SVG, imágenes o atributos especiales no se marcan.
2. Cada página trae un **loader inline de ~300 bytes**. Solo descarga `/assets/editor.js` si existe la cookie `cisa_ed=1` (se pone al iniciar sesión) o si la URL tiene `?editar=1`. Para los visitantes no hay ninguna petición extra ni cambio visual.
3. **Login con enlace mágico.** En `https://<sitio>/?editar=1` se escribe el correo. Si está en `EDITOR_ALLOWED_EMAILS`, llega un enlace que vence en 15 min. Al abrirlo se crea una cookie `HttpOnly` firmada (HMAC) que dura 8 h. Si un correo se quita de la lista, su sesión deja de valer de inmediato.
4. **`assets/editor.js`** activa `contenteditable` solo en `[data-edit]`, pega siempre como texto plano, guarda un borrador en el navegador y ofrece **Enviar a revisión / Descartar / Salir**.
5. **`api/editar.js`** valida la sesión y el `Origin`, aplica un rate limit (10 envíos por hora por usuario y 20 por IP) y limita el tamaño (64 KB por petición, 60 cambios y 4000 caracteres por texto). Después sanitiza, lee el HTML de `main` desde GitHub y reemplaza **solo el contenido del nodo** usando los offsets del parser `parse5`, sin regex y sin tocar ningún otro byte. Valida que el documento siga teniendo los mismos nodos editables y crea la rama `edicion/<fecha>-<usuario>-xxxx`, un commit y un PR. **Nunca escribe en `main`.**

## Por qué enlace mágico y no Clerk

- **Cero peso para los visitantes.** Clerk exige cargar su SDK en el navegador para saber si hay sesión, y el enlace mágico no carga nada.
- **No hay otro proveedor de identidad ni panel extra.** La lista de correos es una variable de entorno, y para revocar a alguien basta con editarla.
- Son pocas personas y se edita de vez en cuando, así que no hacen falta usuarios, contraseñas ni MFA. El costo es USD 0: Resend da 3,000 correos al mes en el plan gratis.
- La contra es que hace falta un remitente de correo verificado (Resend) para mandar los enlaces.

## Variables de entorno (Vercel → cisa → Settings → Environment Variables)

Márcalas como **Sensitive** y ponlas en Production y Preview.

| Variable | Obligatoria | Valor |
|---|---|---|
| `EDITOR_SESSION_SECRET` | Sí | Cadena aleatoria de 32 caracteres o más: `openssl rand -base64 48` |
| `EDITOR_ALLOWED_EMAILS` | Sí | Correos separados por coma: `alberto@...,cliente@...` |
| `RESEND_API_KEY` | Sí | API key de https://resend.com (permiso *Sending access*) |
| `EDITOR_EMAIL_FROM` | Sí | Remitente de un dominio verificado en Resend, p. ej. `Editor CISA <editor@grupocisa.mx>` |
| `GITHUB_APP_ID` | Sí | App ID de la GitHub App |
| `GITHUB_APP_INSTALLATION_ID` | Sí | Id de la instalación en `abalderasdev/cisa` |
| `GITHUB_APP_PRIVATE_KEY` | Sí | Contenido del `.pem`. Se acepta con saltos reales o con `\n` |
| `GITHUB_REPO` | No | Por defecto `abalderasdev/cisa` |
| `GITHUB_BASE_BRANCH` | No | Por defecto `main` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Recomendado | Rate limit global y enlaces de **un solo uso** entre instancias. Sin ellas, ambos funcionan por instancia, en memoria, como mejor esfuerzo |

## Crear la GitHub App

1. GitHub → Settings → Developer settings → **GitHub Apps → New GitHub App**.
   - Nombre: `cisa-editor`. Homepage: la URL del sitio. **Webhook: desactivado**.
   - **Repository permissions:** *Contents: Read and write* y *Pull requests: Read and write*. *Metadata: Read* se agrega solo. Ningún otro permiso: sin Workflows, sin Administration.
   - "Where can this app be installed": **Only on this account**.
2. Copia el **App ID** y genera una **private key** (.pem) desde *Private keys → Generate*.
3. **Install App** → solo el repositorio `abalderasdev/cisa`. El número final de la URL de la instalación (`/settings/installations/<ID>`) es `GITHUB_APP_INSTALLATION_ID`.
4. Recomendado: protege `main` con PR obligatorio para que nadie, incluida la App, pueda escribir directo.

## Resend (correo del enlace)

1. Crea una cuenta en https://resend.com → Domains → agrega el dominio del remitente y configura los DNS (SPF/DKIM) que indica.
2. API Keys → crea una con *Sending access* → `RESEND_API_KEY`.

## Uso

1. Abre `https://<sitio>/?editar=1`, escribe tu correo y abre el enlace que te llega.
2. Haz clic sobre cualquier texto con contorno punteado y edítalo. Los cambios quedan marcados en ámbar. *Shift+Enter* inserta un salto de línea en párrafos, y *Ctrl+B / Ctrl+I* ponen negritas y cursivas.
3. **Enviar a revisión** → aparece la liga al PR. Revisa la vista previa de Vercel y haz merge para publicar.

## Desarrollo

- `npm test` corre las pruebas del sanitizer, del reemplazo de nodos, de la sesión y del marcado de las 28 páginas.
- `npm run mark-editable` marca los textos nuevos después de agregar contenido.
- Los ids son estables una vez escritos en el HTML. Si un texto se borra o se mueve en `main`, el envío responde 409 con los ids que ya no existen.
