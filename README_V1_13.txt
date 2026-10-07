MARVEL JUANJO × MARÍA · V1.13.3

BASE
V1.12.4 · Ficha completa abierta. V1.13.3 mantiene la ficha y añade TMDB como única fuente remota de metadata e imágenes, con caché.

VARIABLE DE NETLIFY
TMDB_API_READ_ACCESS_TOKEN = API Read Access Token de TMDB.
No se incluye ningún valor de esta variable en el repositorio ni en el ZIP.

ENDPOINT
/api/marvel-media -> Netlify Function marvel-media.mjs

COMPORTAMIENTO
- La ficha local abre primero.
- La consulta remota se dispara después de abrir la ficha.
- La caché local evita peticiones repetidas durante 30 días.
- Netlify Blobs mantiene una caché persistente de datos públicos durante 30 días antes de refrescar.
- Si TMDB falla o no está configurado, la ficha local sigue funcionando.
- No se modifica Catalog/Progress/Episodes/Ratings/Profile/Settings.
- El póster real sustituye al fallback solo cuando existe una imagen válida.
- El backdrop se usa como fondo visual sutil del bloque principal cuando está disponible.
- El reparto se enriquece con fotos de TMDB y relación actor -> personaje.
- Las temporadas/episodios reciben datos remotos y duraciones cuando existen.

ATRIBUCIÓN
Se muestra la atribución de TMDB en el área de historial/ajustes.
