# Horizon

Planner diario con timeline horizontal y habit tracker. Es una PWA instalable: abre al instante, funciona sin internet y guarda todo en el teléfono (localStorage).

## Correr en local

```sh
python3 -m http.server 8765
# abre http://localhost:8765
```

## Publicar (HTTPS es obligatorio para instalar y para notificaciones)

**GitHub Pages:** sube este folder a un repo → Settings → Pages → Branch `main` / root.
La URL queda tipo `https://<usuario>.github.io/horizon/`.

**Vercel:** `npx vercel` dentro de este folder.

Cada vez que cambies archivos, sube el número en `sw.js` (`VERSION = 'horizon-v2'`) para que el teléfono baje la versión nueva.

## Instalar en el Pixel

Abre la URL en Chrome → menú ⋮ → **Instalar app** (o "Agregar a pantalla principal").
Queda con ícono propio, en pantalla completa, sin barra del navegador.

## Google Calendar (opcional)

1. [console.cloud.google.com](https://console.cloud.google.com) → crea un proyecto.
2. APIs y servicios → Biblioteca → habilita **Google Calendar API**.
3. Pantalla de consentimiento OAuth → Externo, modo *Testing*, agrega tu correo como usuario de prueba.
4. Credenciales → Crear ID de cliente OAuth → **Aplicación web** → Orígenes autorizados de JavaScript: tu URL publicada (ej. `https://<usuario>.github.io`).
5. Pega el ID en `config.js` → `googleClientId: '....apps.googleusercontent.com'`.

Sin ID la app funciona igual, solo sin Google Calendar.

## Notificaciones con el celular bloqueado

- Con la app abierta o en segundo plano reciente: notificación del sistema con sonido, también en pantalla bloqueada.
- Con la app cerrada por mucho rato, Android puede congelarla y el aviso no sale. Las páginas web no pueden programar alarmas exactas.
- **Lo confiable hoy:** marca *Also add to Google Calendar* al crear la tarea. La app de Google Calendar suena a la hora exacta, aunque el teléfono esté bloqueado.
- Para que la propia Horizon suene siempre, hace falta un servidor de push (ej. Cloudflare Worker) o empaquetarla como app nativa (Capacitor).

## Datos

Todo vive en el navegador del teléfono. Si borras los datos de Chrome o desinstalas, se pierden. Las tareas que mandas a Google Calendar quedan también allá.
