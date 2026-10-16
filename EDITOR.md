# Editor en vivo (textos) — Grupo CISA

Permite que personas autorizadas editen títulos, párrafos, listas y botones **directamente sobre la página publicada**. Cada envío abre un **Pull Request** en `Capitalta-web/cisa`. Vercel genera la vista previa y **nada se publica sin el merge** de Alberto.

## Cómo funciona

1. Cada texto editable tiene `data-edit="<id estable>"`, p. ej. `index.hero.p-1`. Los del menú (`header.site-header`) y del pie (`footer.footer`) usan ids `global.header.*` / `global.footer.*`, y un cambio ahí se aplica en **todas** las páginas que tengan ese id.
   - Los marca `node scripts/mark_editable.js`. Es idempotente: los ids existentes no cambian y al volver a correrlo solo se marcan los textos nuevos. `--check` solo reporta.
   - Solo se marcan los elementos cuyo contenido es texto con formato simple (`b/strong/i/em/br`, `<a href>`, `<span class>`). Los que llevan iconos SVG, imágenes o atributos especiales no se marcan.
2. Cada página trae un **loader inline de ~300 bytes**. Solo descarga `/assets/editor.js` si existe la cookie `cisa_ed=1` (se pone al iniciar sesión) o si la URL tiene `?editar=1`. Para los visitantes no hay ninguna petición extra ni cambio visual.
3. **Login con usuario y contraseña.** En `https://<sitio>/?editar=1` aparece un formulario pequeño. Los usuarios y sus hashes **scrypt** vienen de la variable `EDITOR_USERS`; ninguna contraseña en texto plano se guarda ni viaja fuera del formulario HTTPS. Un login correcto crea una cookie `HttpOnly` firmada con HMAC que dura 8 h. Para quitarle el acceso a alguien, basta con borrarlo de `EDITOR_USERS`: su sesión deja de valer de inmediato.
   - Protección: verificación con `crypto.timingSafeEqual`, el mismo tiempo de cálculo aunque el usuario no exista y un mensaje genérico ("Usuario o contraseña incorrectos"). También se revisa el `Origin` y hay un límite de 20 intentos por IP cada 15 min.
   - Tras 5 fallos seguidos, ese usuario queda **bloqueado 15 min**, y cada fallo tarda más en responder (250 ms → 4 s).
4. **`assets/editor.js`** activa `contenteditable` solo en `[data-edit]`, pega siempre como texto plano, guarda un borrador en el navegador y ofrece **Enviar a revisión / Descartar / Salir**.
5. **`api/editar.js`** valida la sesión y el `Origin`, aplica un rate limit (10 envíos por hora por usuario y 20 por IP) y limita el tamaño (64 KB por petición, 60 cambios y 4000 caracteres por texto). Después sanitiza, lee el HTML de `main` desde GitHub y reemplaza **solo el contenido del nodo** usando los offsets del parser `parse5`, sin regex y sin tocar ningún otro byte. Valida que el documento siga teniendo los mismos nodos editables y crea la rama `edicion/<fecha>-<usuario>-xxxx`, un commit y un PR. **Nunca escribe en `main`.**

## Por qué usuario y contraseña (decisión de Alberto)

- No depende de ningún servicio externo: ni proveedor de correo ni de identidad. Tampoco agrega peso para los visitantes.
- Los hashes usan **scrypt** del módulo `crypto` de Node: no requiere dependencias y funciona en Vercel. Parámetros: N=32768, r=8, p=1, sal aleatoria de 16 bytes y hash de 32 bytes.
- Las contraseñas deben tener al menos 12 caracteres, y la herramienta para generar el hash lo exige.

## Generar el hash de un usuario (en tu computadora)

```bash
git clone https://github.com/Capitalta-web/cisa && cd cisa && git checkout editor-en-vivo
npm run hash-password -- alberto
# Contraseña: ********   Repite la contraseña: ********
# -> alberto:scrypt$32768$8$1$<sal>$<hash>
```

Copia esa línea completa en `EDITOR_USERS`. Si son varios usuarios, sepáralos con comas: `alberto:scrypt$...,cliente:scrypt$...`. La contraseña nunca sale de tu computadora. Para cambiarla, genera un hash nuevo y reemplaza la línea de ese usuario.

## Variables de entorno (Vercel → cisa → Settings → Environment Variables)

Márcalas como **Sensitive** y ponlas en Production y Preview.

| Variable | Obligatoria | Valor |
|---|---|---|
| `EDITOR_SESSION_SECRET` | Sí | Cadena aleatoria de 32 caracteres o más: `openssl rand -base64 48` |
| `EDITOR_USERS` | Sí | `usuario:scrypt$…` separados por coma, generados con `npm run hash-password -- <usuario>` |
| `GITHUB_APP_ID` | Sí | App ID de la GitHub App |
| `GITHUB_APP_INSTALLATION_ID` | Sí | Id de la instalación en `Capitalta-web/cisa` |
| `GITHUB_APP_PRIVATE_KEY` | Sí | Contenido del `.pem`. Se acepta con saltos reales o con `\n` |
| `GITHUB_REPO` | No | Por defecto `Capitalta-web/cisa` |
| `GITHUB_BASE_BRANCH` | No | Por defecto `main` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Recomendado | Rate limit y bloqueo de login **globales** entre instancias. Sin ellas se cuentan por instancia, en memoria, como mejor esfuerzo |

## Crear la GitHub App

1. GitHub → Settings → Developer settings → **GitHub Apps → New GitHub App**.
   - Nombre: `cisa-editor`. Homepage: la URL del sitio. **Webhook: desactivado**.
   - **Repository permissions:** *Contents: Read and write* y *Pull requests: Read and write*. *Metadata: Read* se agrega solo. Ningún otro permiso: sin Workflows, sin Administration.
   - "Where can this app be installed": **Only on this account** (créala en la organización Capitalta-web, o hazla instalable ahí).
2. Copia el **App ID** y genera una **private key** (.pem) desde *Private keys → Generate*.
3. **Install App** → solo el repositorio `Capitalta-web/cisa`. El número final de la URL de la instalación (`/settings/installations/<ID>`) es `GITHUB_APP_INSTALLATION_ID`.
4. Recomendado: protege `main` con PR obligatorio para que nadie, incluida la App, pueda escribir directo.

## Uso

1. Abre `https://<sitio>/?editar=1` y entra con tu usuario y contraseña.
2. Haz clic sobre cualquier texto con contorno punteado y edítalo. Los cambios quedan marcados en ámbar. *Shift+Enter* inserta un salto de línea en párrafos, y *Ctrl+B / Ctrl+I* ponen negritas y cursivas.
3. **Enviar a revisión** → aparece la liga al PR. Revisa la vista previa de Vercel y haz merge para publicar.

## Desarrollo

- `npm test` corre las pruebas del sanitizer, del reemplazo de nodos, de la sesión y del marcado de las 28 páginas.
- `npm run mark-editable` marca los textos nuevos después de agregar contenido.
- Los ids son estables una vez escritos en el HTML. Si un texto se borra o se mueve en `main`, el envío responde 409 con los ids que ya no existen.
