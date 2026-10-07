MARVEL · CAMINO AL MULTIVERSO · V1.15

Despliegue Netlify
1. Sube el contenido de esta carpeta como sitio Netlify o despliega el ZIP en el mismo sitio que ya usa la aplicación.
2. Netlify debe tener acceso a Netlify Blobs para las Functions.
3. Configura en Netlify las cuatro variables secretas indicadas en la sección «VARIABLES DE NETLIFY · PRODUCCIÓN · SCOPE FUNCTIONS».
4. Haz un nuevo deploy después de crear o modificar variables.

Comportamiento de sincronización
- Cada perfil tiene un espacio cloud independiente.
- Al entrar con sesión recordada se intenta recuperar primero el estado cloud.
- Si el perfil no existe todavía en nube, se crea automáticamente una copia oficial inicial.
- La sincronización tiene timeout; nunca deja la aplicación bloqueada indefinidamente.
- Los cambios normales se guardan localmente de inmediato y la nube se actualiza mediante Guardar cambios.
- Al ocultar/salir de la página existe una copia keepalive de seguridad cuando el navegador lo permite.

Núcleo de progreso
- Un título es una unidad de catálogo.
- Los capítulos y temporadas son unidades internas de una serie, nunca títulos independientes.
- Las acciones de progreso están ligadas al titleId y, cuando corresponde, season/episode/person.
- No se utiliza un detector global de títulos modificados para decidir una valoración rápida.

Identidad
- Perfil administrador virtual: `administrador1 × administrador2` (`marvel-admin-root`).
- Acceso administrador: exclusivamente `MARVEL_ROOT_ADMIN_TOKEN`; el administrador no es un perfil Marvel de consumo y no tiene progreso propio.
- Juanjo × María: perfil `USER` normal, ID `jm-user`, autenticado con su PIN configurado en `MARVEL_JUANJO_MARIA_PIN`.
- Solo una sesión ADMIN puede crear y eliminar perfiles.

PWA
- manifest.webmanifest
- sw.js
- iconos 192/512 + maskable


V142 / v1.9 Loki: los guardados manuales esperan cualquier guardado cloud inicial en curso en lugar de devolver falso; esto evita que «Guardar y salir» falle por una carrera con la sincronización de arranque.

V1.10.2 LOKI — MIGRACIÓN DEL GATEWAY DE ACCIONES

Basada en la refundación V1.10 Loki. Progreso, valoraciones y favoritos usan ahora el gateway MarvelApp.dispatch() y los motores canónicos.
- Store único sobre window.app.* sin duplicar el estado persistente.
- Dominios: Catalog, Progress, Episodes, Ratings, Achievements, Profile y Settings.
- Selectors de solo lectura y gateway MarvelApp.dispatch().
- MarvelProgressEngine se mantiene como único motor canónico de progreso.
- V115 queda limitado al playback para evitar competencia con los propietarios canónicos de progreso/ratings/hero.
- La apariencia visual de la aplicación se conserva.

V1.10.8 LOKI — IDENTIDAD POR PERFIL Y VALORES PREDETERMINADOS
- Los perfiles nuevos arrancan directamente con los nombres introducidos al crearlos.
- Las iniciales visibles se calculan automáticamente a partir de esos nombres cuando no se ha fijado una abreviatura manual.
- El perfil raíz se presenta como Juanjo × María con J. y M. en la interfaz.
- La Ventana de valoración automática queda en «No mostrar nunca» por defecto para perfiles que todavía no tengan una elección guardada.
- Los perfiles ya personalizados conservan sus nombres y preferencias.
- ARCHITECTURE_V1_10_8.txt contiene las pruebas obligatorias de esta versión.


V1.10.11 LOKI — VALORACIONES SINCRONIZADAS
- La pantalla de Valoraciones usa el mismo estado que las fichas.
- Se muestran películas, series, animación, especiales y cortos cuando tienen actividad o una valoración.
- Una nota guardada desde una ficha se refleja al volver al archivo de Valoraciones.
- Eyes of Wakanda (tipo ANIMATED) deja de quedar excluida por el filtro de películas.


V1.11 LOKI — PERFILES Y ADMINISTRACIÓN DEFINITIVA
- Propietario único de perfiles mediante window.MarvelProfileManager.
- Esquema de cuentas normalizado a v1.11 con role/root, identidad estable y updatedAt.
- Gestión de identidad por cuenta sin cambiar la clave cloud estable del perfil.
- Cambio de PIN del propio perfil; el administrador raíz puede restablecer el PIN de otros perfiles.
- Eliminación cloud de perfiles desde la administración raíz mediante DELETE y MARVEL_ROOT_ADMIN_TOKEN.
- El perfil raíz juanjo-maria-root nunca puede eliminarse en servidor.
- La clave administrativa, cuando se usa desde la interfaz, se guarda solo en sessionStorage de esta sesión.
- Crear/switch de perfiles conserva la separación local por namespace y fuerza la recarga de la cuenta elegida para volver a ejecutar el autoload cloud del perfil correspondiente.
- No se modifica la identidad cloud estable al renombrar personas o cambiar el PIN.


V1.11.1 — PIN raíz
- PIN inicial del administrador raíz: el valor predeterminado configurado en la aplicación.
- Si la cuenta raíz histórica todavía usa el PIN predeterminado histórico, la aplicación lo migra automáticamente al nuevo valor predeterminado.
- El PIN no sustituye a MARVEL_ROOT_ADMIN_TOKEN: el borrado Cloud sigue requiriendo la variable server-side en Netlify.


V1.11.4 — ADMINISTRACIÓN NETLIFY ENV
- Esta versión NO contiene ningún token administrativo en el código.
- El servidor solo acepta el valor de MARVEL_ROOT_ADMIN_TOKEN definido en Netlify.
- Desde Gestión de perfiles → Clave admin se introduce la misma clave solo en sessionStorage de esta sesión.
- El botón «🧪 Comprobar» realiza una petición no destructiva para validar que la Function ve y acepta la variable de Netlify.
- Una vez validada, «🗑️ Eliminar» ejecuta DELETE contra la cuenta secundaria.
- La cuenta raíz juanjo-maria-root permanece protegida.

Despliegue recomendado
1. Mantén `MARVEL_ROOT_ADMIN_TOKEN` con el mismo valor actual que ya usa el proyecto.
2. Crea `MARVEL_SESSION_SECRET` y `MARVEL_PROFILE_PEPPER` como secretos largos y aleatorios.
3. Crea `MARVEL_JUANJO_MARIA_PIN` con el PIN actual de Juanjo × María.
4. Marca las cuatro variables como secret values y con scope Functions/Production.
5. Despliega V1.15 en el MISMO proyecto Netlify y espera al deploy.
6. Abre la app y entra por `administrador1 × administrador2` usando `MARVEL_ROOT_ADMIN_TOKEN`.
7. Desde Administración crea los perfiles que vayan a utilizarse.
8. En el dispositivo que todavía tenga perfiles V1.14 locales, ejecuta una sola vez «Migrar perfiles de este dispositivo».
9. Comprueba desde otro dispositivo que Juanjo × María y los perfiles creados aparecen y se autentican con su PIN.


V1.12 Loki — Fichas enriquecidas
- Capa de ficha enriquecida sobre el núcleo Loki.
- No añade un segundo estado.
- Póster fallback local; TMDB/imágenes externas quedan para V1.13.

V1.14 · CIERRE TÉCNICO
- Baseline funcional: V1.13.29.
- Se retiran únicamente alias/banderas históricas demostrablemente sin consumidores internos.
- Se revisan listeners/observers y el aislamiento de perfiles sin rehacer el motor de progreso.
- Versión de release: 1.14.0.
- Service Worker: cachés V1-14-0 para forzar la transición de la shell anterior.
- Los controles de TMDB, Cloud, perfiles, fichas, recomendaciones y progreso se conservan.


V1.15 · IDENTIDAD CLOUD Y ADMINISTRACIÓN SERVER-SIDE
- El directorio de perfiles vive en Netlify Blobs: `marvel-marathon-profiles-v1`.
- El perfil administrador es virtual: `administrador1 × administrador2` y se autentica exclusivamente con `MARVEL_ROOT_ADMIN_TOKEN`.
- Juanjo × María deja de ser root/admin y queda como perfil USER normal con su PIN existente. Su alta inicial usa `MARVEL_JUANJO_MARIA_PIN` únicamente como secreto de bootstrap en Netlify.
- Los perfiles USER se autentican con PIN en la Function; el navegador recibe una cookie `HttpOnly; Secure; SameSite=Lax` firmada por `MARVEL_SESSION_SECRET`.
- Los verificadores nuevos de PIN usan scrypt y un secreto server-side `MARVEL_PROFILE_PEPPER`. Los perfiles migrados desde V1.14 usan su verificador PBKDF2 antiguo solo hasta el primer acceso, momento en el que se actualizan a scrypt.
- Crear perfil, renombrar, cambiar/resetear PIN y eliminar perfil pasan por la Function. Crear y eliminar requieren sesión ADMIN; el servidor no confía en campos de rol enviados por el navegador.
- El borrado de usuario elimina también su estado cloud. El perfil administrador nunca se puede eliminar desde la aplicación.
- Existe una acción admin de migración local de un solo paso para trasladar los perfiles que todavía existan en LocalStorage de V1.14, incluyendo una instantánea de su estado y su verificador de PIN antiguo.

La guía paso a paso de Netlify está también en `NETLIFY_SETUP_V1_15.txt`.

VARIABLES DE NETLIFY · PRODUCCIÓN · SCOPE FUNCTIONS · CONTAINS SECRET VALUES
1. `MARVEL_ROOT_ADMIN_TOKEN` → conserva exactamente el token administrativo que ya utilizas. Este es el ÚNICO secreto que permite entrar al perfil `administrador1 × administrador2` y acceder a la administración.
2. `MARVEL_SESSION_SECRET` → secreto aleatorio largo y único para este proyecto; no reutilizarlo en otros sitios.
3. `MARVEL_PROFILE_PEPPER` → secreto aleatorio largo y único para este proyecto; solo lo consumen las Functions.
4. `MARVEL_JUANJO_MARIA_PIN` → el mismo PIN actual que ya usa Juanjo × María. No lo pongas en el código ni en `netlify.toml`.

MODELO FINAL DE CUENTAS
- `administrador1 × administrador2` → ADMIN virtual, sin progreso Marvel, acceso solo con `MARVEL_ROOT_ADMIN_TOKEN`. Es el único que puede crear y eliminar perfiles.
- `Juanjo × María` → USER normal, nunca ADMIN/root, con el PIN definido en `MARVEL_JUANJO_MARIA_PIN`.
- Los demás perfiles → USER normales, creados exclusivamente desde la consola ADMIN.

Tras crear o modificar las variables, haz un nuevo deploy para que las Functions reciban los valores. Marca las cuatro como secret values; Netlify mantiene los secretos fuera del código y limita su exposición a código que corre dentro de su infraestructura.

FLUJO DE PRIMERA MIGRACIÓN
1. Despliega V1.15 en el mismo proyecto Netlify.
2. Desde la pantalla de acceso, entra en `administrador1 × administrador2` usando `MARVEL_ROOT_ADMIN_TOKEN`.
3. En Administración pulsa `Migrar perfiles de este dispositivo`.
4. Debe aparecer Juanjo × María y cualquier perfil local heredado. El servidor conserva sus datos cloud existentes cuando ya están presentes; si no existen, sube la copia local.
5. Cierra sesión admin y comprueba que Juanjo × María aparece como usuario normal.
6. Desde otro dispositivo, selecciona Juanjo × María e introduce su PIN: el perfil se autentica contra Netlify y recupera el mismo estado cloud.

SEGURIDAD
- No guardes ninguno de estos cuatro valores en `index.html`, `netlify.toml`, `.env` del repositorio ni documentación pública.
- No desactives Secret Scanning.
