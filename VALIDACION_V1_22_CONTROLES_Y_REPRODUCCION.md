# Controles y reproducción en curso — validación de desarrollo

Fecha: 7 de octubre de 2026. Este lote correspondió a la primera familia de correcciones de V1.22. No constituyó el cierre de V1.22, una Release Candidate ni una autorización de producción.

## Fallos reproducidos y corregidos

El botón «En progreso» reutilizaba la clase `progress` de las barras de progreso. En Chromium con interacción táctil y un ancho de 432 píxeles, la versión original presentó un margen superior de 9 píxeles y una altura de 18 píxeles, frente a aproximadamente 34,8 píxeles en los otros botones de su fila. Se separó su clase visual de la clase de las barras y se establecieron dimensiones comunes para todos los filtros rápidos y de tipo. La selección siguió diferenciándose por sus colores y por `aria-pressed`, con foco de teclado visible. Se conservaron los saltos de línea responsivos de la fila.

Una animación global de pulsación también aplicaba una escala a estos controles. Se excluyeron de esa animación los filtros, Normal/Editar y las acciones de vistas guardadas. Se mantuvieron las microinteracciones del resto de la aplicación. La posición relativa necesaria para el efecto de pulsación quedó definida desde el inicio, sin cambiar al tocar el control.

El filtro «En progreso» buscaba marcas de visto o capítulos completados, pero no consultaba las posiciones activas. Se conectó al selector de reproducción existente. El panel de Inicio estaba leyendo una propiedad `window.CATALOG` que no existía, en lugar del catálogo canónico; se corrigió esa referencia sin crear otro catálogo. Se excluyeron de los selectores los títulos completados, futuros, eliminados o ignorados, los capítulos completados y las posiciones de temporadas futuras o ignoradas.

Dos personas con posiciones diferentes quedaron identificadas como «Ambos en curso», conservando sus dos posiciones; una posición común se representó en una sola fila. Una marca antigua de reproducción compartida dejó de ocultar posiciones distintas. La ficha reutilizó este mismo selector y abrió el capítulo realmente seleccionado, en lugar de sustituirlo por el primer capítulo pendiente. Las insignias del catálogo se colocaron sobre las tarjetas reales y se recuperaron tras sus renderizados, sin alterar datos.

Se corrigieron dos referencias que interrumpían la reproducción y la apertura de fichas: un formateador de tiempo ausente y una llamada a un helper de nombres situado en otro ámbito. Se reutilizó el helper existente, sin duplicar la traducción de nombres. Los tiempos del panel dejaron de interpretar segundos como minutos.

El borrado de vistas guardadas permanecía deshabilitado después de guardar o seleccionar una vista. Se sincronizó su disponibilidad con la selección actual mediante el renderizador existente de vistas guardadas.

## Pruebas realizadas

La batería se ejecutó fuera del repositorio, sin añadir un nuevo sistema de pruebas ni dependencias a la aplicación. Se utilizó Netlify Dev local en el puerto 8889. Las comprobaciones funcionales emplearon perfiles y estados de prueba aislados del navegador; los endpoints Cloud se simularon como no disponibles, sin autenticación real ni escritura remota.

| Puerta | Resultado de este lote | Límites |
| --- | --- | --- |
| Código | Se analizaron los 50 scripts inline; se comprobaron sintaxis de las cuatro Functions y su biblioteca, balance de 50 bloques de estilos y scripts, JSON del manifest y sus cuatro iconos. `git diff --check` pasó. | No se ejecutó un build manual; quedó reservado a la validación automática de la plataforma. La referencia preexistente a `sw.js` no tuvo un archivo correspondiente y quedó pendiente para PWA. |
| Estado | Pasaron 29 casos de selectores, verificando también que el estado, metadatos y catálogo no cambiaron al consultarlos. | No se declaró validada la convergencia Cloud. |
| Funcional | Pasaron combinación En progreso + Series, insignias tras renderizar, guardar/cargar/borrar vistas, posiciones compartidas de películas y series, capítulo actual, guardar una posición sin sobrescribir la otra y guardar una posición común para ambos. También pasaron marcar/desmarcar, completar serie, capítulos, favoritos y valoraciones mediante las acciones canónicas. | Importación, restauración, backups y autenticación real no formaron parte de este lote. |
| Visual | Pasaron 160 comprobaciones de controles a 360, 432, 768, 1366 y 1920 píxeles, en claro y oscuro. Se verificaron geometría, foco, selección y pulsaciones, con interacción táctil en los dos tamaños móviles. | Chromium emulado no sustituyó Android, tablet o escritorio físicos; teclado virtual y revisión de todas las pantallas quedaron pendientes. |
| Regresión | Los filtros no cambiaron `app.state.items`. El guardado individual conservó 00:35:00 para Juanjo y 00:42:00 para María; el compartido conservó 00:30:00 para ambos. Completar una película y una serie produjo dos títulos completados por ambos, sin cambiar los 124 títulos del catálogo ni contar capítulos como títulos. No aparecieron errores JavaScript en el recorrido funcional comprobado. | No se completó la prueba maestra de toda la aplicación ni la auditoría global de Timeline, actividad, estadísticas y Cloud. |

Los 29 casos de estado cubrieron pendientes, favoritos sin iniciar, visto sin posición, Juanjo, María, ambos con posiciones iguales o distintas, marca compartida antigua, un único punto explícitamente compartido, una persona completada, títulos completados con posiciones antiguas, tiempos inválidos o terminados, capítulos iguales o distintos, capítulos y series completados, temporadas no iniciadas, índices fuera de rango y exclusión de contenidos futuros, eliminados e ignorados. Se mantuvo una sola agrupación por título.

## Conservación y siguientes puertas

No se modificaron la arquitectura Cloud, las Functions, el motor de progreso, la persistencia, los algoritmos de favoritos o valoraciones, la tarjeta blanca de siguiente recomendación, la navegación de Timeline ni las fuentes de tráileres. No se realizaron despliegues ni se incrementó la versión como si todas las puertas estuvieran cerradas.

Quedaron pendientes la comprobación física de los controles, la integración global de reproducción con siguiente recomendación, Timeline, estadísticas y `activityEvents`, y la prueba Cloud de dos dispositivos con backup y restauración. También se mantuvo pendiente reconciliar las versiones preexistentes de package/manifest (1.22.4) y del marcador HTML (1.22.6) al cerrar una versión validada. V1.23, V1.24, V1.25 y la auditoría final no se iniciaron, respetando la prohibición de avanzar sin estabilizar la familia anterior.
