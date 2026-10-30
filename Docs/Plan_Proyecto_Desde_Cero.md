# Plan: un proyecto desde cero, y la ayuda con recorridos (D816–D821)

**Estado (v0.308):** hecho todo lo de las secciones 2 a 6 en el código, con los nueve capítulos de *A project from
scratch* recorridos con clics. La mudanza de los decorados de VLLF y ERSO (sección 3) quedó aplicada y verificada el
2026-10-29 (202 operaciones, ninguna otra página tocada), con su copia y su deshacer. Lo que Lega pidió después de
probarla (Esc vuelve a la tabla, los colores, el *Panorama* siempre y la miniatura en el carrete) está en D822–D825,
v0.309 y v0.310. Quedan para Lega: una carpeta de Scouting con botón propio y tabla (hoy se crea con el «+» de la
fila), y si las listas desplegables del *Overview* (D806, D807) se quedan.

Pedido de Lega (2026-10-28, a la noche, antes de dormir). Las etiquetas de la semana de Rodaje cambian a PLN y REP,
alineadas con el nombre de la semana, en ámbar y verde. Lega no entiende la diferencia entre las locaciones y los
decorados de *Pages* y los del *Overview*. Pide:

- que `Desglose` se llame `Escenas` (lo renombró él mismo en VLLF) y que el *Overview* empiece por las escenas;
- que *Preproducción* sea Escenas y Locaciones, sin una carpeta de Decorados («en general es al revés: dentro de
  las locaciones se escribe qué escenas y qué decorados van ahí»), con los decorados armándose solos;
- en la página de Escenas, un botón para crear una escena y una mini tabla: foto, número, locación y decorado;
- en una escena nueva, el título partido en dos: el número en gris y el nombre;
- que todo proyecto nuevo arranque con las páginas principales, vacías;
- una ayuda nueva: arriba el nombre de la app, que la hizo él y su página, como en sus otras apps; debajo, los
  recorridos con capítulos. Menos texto, la ventana redimensionable y la barra de desplazamiento fina como la de la
  barra lateral;
- un recorrido que arme un proyecto desde cero: escenas, locaciones creadas desde la escena, el salto a «ya hay 20
  escenas», y cómo de eso salen las relaciones y el *Overview*. Tiene que probarse con clics, y lo que el recorrido
  muestre que no cierra se arregla.

Reglas que no se rompen: **no se pierde nada** de lo que hay en VLLF y ERSO (se mueve, se renombra o se marca, nunca
se borra), y **el tráfico de salida de Supabase se cuida**. El recorrido corre en memoria, sin tocar la base. El
árbol por cambios de v0.301 no se toca, y cada auditoría lo revisa.

## 1. La lógica, en una frase por parte

- **Pages es lo que escribís.** Cada etapa es una carpeta; en cada carpeta, una página por cosa.
- **El Overview se arma solo** con lo que escribís, y no se edita. No repite las listas de *Pages*: cada parte es una
  vista (una tabla) que junta lo que todas las páginas dicen de cada escena, locación, decorado y día.
- **Una escena** es una página en `Escenas`, titulada `029 | Nombre`. En su página se escriben su locación y su
  decorado (campos), sus planos y sus notas.
- **Una locación** es una página en `Locaciones`. Su cabecera muestra sola qué escenas se planean ahí, qué
  decorados se filman ahí, sus scoutings y sus días.
- **Un decorado** (el lugar de la historia, la «Locación Guion» de Coda) es una página **adentro de su locación**
  (la «Locacion Real»). Se crea desde la cabecera de la locación (*New set*) y se filma ahí. La escena lo nombra en su
  campo de decorado; la locación y el *Overview › Sets* lo juntan solos. Una revisión independiente mostró que un
  decorado sin página no existe para la app (`register.ts`, `liveView.ts`): por eso siempre tiene página.
- **La dirección escena ↔ locación** vale para los dos lados: la escena dice su locación (campo *Location*), y la
  página de una locación puede decir qué escenas van ahí (su campo de escenas). Las dos cuentan como planeadas ahí.
- **Rodaje:** semanas, y en cada semana los días con su plan (PLN) arriba de su reporte (REP).

## 2. Estructura de un proyecto nuevo (D817)

Al crear un proyecto se crean, vacías y con su tipo, las carpetas de las etapas. Los nombres van en el idioma de la
interfaz:

| es | en | Tipo |
|---|---|---|
| `1 \| Preproducción` | `1 \| Preproduction` | — |
| `1.1 \| Escenas` | `1.1 \| Scenes` | escenas |
| `1.2 \| Locaciones` | `1.2 \| Locations` | locaciones |
| `2 \| Scouting reports` | `2 \| Scouting reports` | scoutings |
| `3 \| Pruebas y previs` | `3 \| Tests and previs` | pruebas |
| `4 \| Rodaje` | `4 \| Shoot` | días (reportes) |
| `5 \| Referencias` | `5 \| References` | — |
| `90 \| Archivo` | `90 \| Archive` | fuera del *Overview* |

## 3. Escenas, locaciones y decorados en Pages (D818)

- **Página de Escenas** (una carpeta con tipo escenas): arriba, el botón *New scene* y una tabla armada sola. Cada
  fila tiene la primera foto de la escena, el número, el nombre, la locación y el decorado. Un clic abre la escena.
  No se guarda nada en la página: se arma con el índice, como el *Overview*.
- **Página de Locaciones** (tipo locaciones): el botón *New location* y la misma tabla, con foto, nombre, decorados y
  escenas.
- **Escena nueva:** *New scene* propone el número siguiente libre. El título se ve partido: el número en gris (se
  puede cambiar) y el nombre, con el foco en el nombre. Se guarda como siempre (`029 | Nombre`).
- **Decorados:** sin carpeta propia en un proyecto nuevo. En VLLF y ERSO, cada página de `1.3 | Decorados` se marca
  como decorado (la marca va **antes** de mover: si no, adentro de una locación se leería como un scouting) y pasa
  **adentro de su locación** si tiene una sola conocida, con su contenido entero. Los demás (sin locación conocida, o
  filmados en más de una) quedan en `1.3 | Decorados`, que se queda solo con esos: se ve cuáles faltan ubicar. Un
  decorado nuevo se crea desde la cabecera de su locación (*New set*).
- **Mover no cambia el tipo:** una página que era decorado (o escena, o locación) por su carpeta lo sigue siendo al
  arrastrarla adentro de otra entidad.
- **El Overview empieza por Scenes:** Scenes, Locations, Sets, Shoot days, Shots, Pending. Las listas desplegables de
  la barra (D806/D807, pedidas el 27/10) se quedan: sacarlas es decisión de Lega.

## 3 bis. Las tablas (D821)

Toda tabla que arma la app (la de Escenas y la de Locaciones de su carpeta, las vistas del *Overview*, *Shots*):

- **Columnas que se agrandan**, en porcentaje del ancho de la tabla (sigue al ancho de la página): se arrastra el
  borde derecho del encabezado (lo que gana una columna lo pierden las de su derecha) o ←/→ con el foco en ese borde.
  Doble clic ajusta la columna a lo más largo que tiene escrito (hasta la mitad de la tabla), sacando el lugar de las
  de su derecha en proporción a lo que le sobra a cada una; en una columna sin texto (la foto) vuelve la tabla a los
  anchos de fábrica. Se recuerda por tabla en el dispositivo.
- **El encabezado queda pegado** debajo de la barra de arriba mientras se ve alguna fila, y se va con la última, como
  las carpetas de la barra lateral. *Shots*, que se desplaza también de costado, lo pega dentro de su caja.
- Las tablas que se escriben en una página (las del editor) se agrandan arrastrando, como siempre. Su encabezado
  también queda pegado desde v0.313 (D827): como la caja que las desplaza de costado no deja usar `position: sticky`,
  `src/ui/tableStickyHead.ts` corre las celdas del renglón de encabezado lo que la tabla se metió debajo de la barra.

## 4. Rodaje (D816, hecho)

PLN (ámbar, `--warn`) y REP (verde, `--ok`) en el lugar del triángulo de la fila. Así quedan alineados con el nombre
de la semana, y las fechas forman una sola columna.

## 5. La ayuda (D819)

Como en las demás apps LGA:

1. **Encabezado:** `LGA Shot Docs` y la versión, *Developed by Lega Pugliese* y el link `lega.com.ar` (#8C7ED9, sin
   subrayar).
2. **Tours:** la lista de recorridos, cada uno con sus capítulos. Cada capítulo muestra si ya se vio, *Continue* lleva
   a donde quedaste y *Start over* empieza de cero. Es lo primero, porque la ayuda es sobre todo con recorridos.
3. **Topics:** lo que hoy son las entradas, plegadas (se ve el título; un clic despliega el texto), con la búsqueda.
4. **Shortcuts:** la tabla de atajos.

La ventana se agranda desde la esquina y recuerda su tamaño en el dispositivo. La barra de desplazamiento es la fina
de la barra lateral. En el teléfono va a pantalla completa, como hoy.

## 6. Los recorridos (D820)

- **El motor:** el de hoy (`src/tutorial/TourLayer.tsx`) suma capítulos y pasos de acción. Un paso de acción se
  cumple cuando pasa algo en la app (se abrió la página de Escenas, existe una escena nueva), avanza solo y nunca lo
  hace *Next*. Toma del skill de recorridos lo que vale en la web: el aro verde `#5fd38a`, el oscurecido de 27 %, Esc
  dos veces para salir, *Back* que no deshace y *Skip chapter*. El progreso se guarda en el dispositivo, por id y
  versión de capítulo.
- **El proyecto de práctica:** la app de verdad (`Shell`) sobre el servidor en memoria de las pruebas
  (`src/sync/testing.ts`), en un documento aparte (`/tour`), sin login, sin red y sin tocar la base de este
  dispositivo. Al salir se vuelve a la página donde estabas. Cada capítulo declara qué necesita del anterior y lo
  arma si falta (para *Skip chapter* o al entrar por un capítulo del medio).
- **Recorridos:**
  1. *Getting around* (el de hoy, en capítulos): la barra, los proyectos, el editor, las fotos, los comentarios.
  2. *A project from scratch:*
     1. El proyecto vacío: qué es cada carpeta de *Pages* y qué hace el *Overview*.
     2. La primera escena: *New scene*, el número y el nombre, una descripción. Aparece en la tabla de Escenas y en
        *Overview › Scenes*.
     3. Su locación: se nombra en el campo *Location* de la escena y se crea su página desde la cabecera de la escena.
        Aparece en `Locaciones` y en *Overview › Locations*; *New location* crea otra desde la carpeta.
     4. El decorado: *New set* en la cabecera de la locación crea su página adentro; la escena lo nombra en su campo y
        aparece en la locación y en *Overview › Sets*.
     5. El salto: «ya cargaste 20 escenas» (la práctica las crea) y la tabla de Escenas llena.
     6. Scouting: un scouting de la locación, con fotos; aparece en la cabecera de la locación.
     7. El plan del día (PLN) y sus consultas a los departamentos.
     8. El reporte del día (REP): una sección por escena; la escena muestra *Shoot | Reports*.
     9. El *Overview*: cómo postproducción encuentra todo lo de una escena.
- **Prueba:** cada capítulo se recorre con clics de verdad (no solo con la vía de las pruebas), también salteando
  capítulos. Lo que no cierra en el recorrido se arregla en la app, no en el texto.
