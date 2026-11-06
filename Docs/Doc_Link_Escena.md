# El link a una escena (v0.317, D837)

Pedido de Lega (2026-11-05): que los supervisores salten desde PipeSync (la tarjeta de un plano, la tabla de producción)
al panorama de su escena en Shot Docs, y que una escena se pueda pasar por link entre el equipo. Esta es la primera
parte: la dirección y *Copy link*. Lo que sigue (que el link entre en la app instalada, el botón en PipeSync, compartir
una escena con un vendor) está en `Doc_Roadmap.md`, «Link a una escena».

## La dirección

```
https://shotdocs.lega.com.ar/map/scenes?project=<proyecto>&scene=<escena>[&w=<workspace>]
```

- **Es la vista de la escena del Panorama** (`/map/scenes?scene=…`, `Doc_Relaciones.md`, sección 21), con dos
  parámetros más. No es una ruta nueva.
- **`project`**: el id del proyecto, su nombre entero o la primera palabra del nombre, sin importar mayúsculas ni
  tildes. `ERSO` abre «ERSO | Serie»; `Villaflor` abre «Villaflor». Es como lo nombran PipeSync y Flow, que no saben
  el id. **Solo si hay uno**: si dos proyectos se llaman igual, o empiezan con la misma palabra y ninguno se llama así
  entero, no se elige ninguno (no se adivina) y la vista los nombra. El nombre entero gana a la primera palabra (`MOR`
  abre «MOR» aunque exista «MOR 2»). La cuenta es sobre los proyectos que ve la persona: si ve «ERSO prueba» y no
  «ERSO | Serie», `ERSO` le abre «ERSO prueba». Por eso el aviso de una escena que no está nombra el proyecto.
- **`scene`**: el número en cualquier forma que entienda la lupa, con el mismo lector (`resolveSceneParam` y
  `searchScenes`, `src/relations/sceneSearch.ts`). Desde v0.319 valen las tres formas: la interna (`101_066`, también
  `101-066`), la de la post (`1066`, `5027b`) y el nombre de un plano (`ERSO_1066_010`, `ERSO_1066_0160_WAN`,
  `ERSO_101_066_010`; el de un inserto, `ERSO_1033A-INS_010`, abre su escena, la `101_033A`), así PipeSync puede
  mandar lo que tenga a mano. Con dos episodios que terminan igual (101 y 201)
  la forma de la post no se adivina: va la interna. La fila de la escena en *Overview › Scenes* se marca igual con
  cualquiera de las tres.
- **`w`** (opcional): la clave local del workspace, como en el link a una página. Elige ese workspace al abrir; si no
  está en el dispositivo, la app va a la pantalla de bienvenida (la de agregar un workspace) con el aviso
  `wsError.pageWorkspace`, igual que con una página. Sin `w`, el workspace de siempre del dispositivo.

## Qué pasa al abrirla

- **El proyecto del link manda** sobre el último elegido en el dispositivo, y queda elegido: al salir del Panorama, el
  inicio y la barra siguen en ese proyecto.
- **Si el proyecto no está** entre los del dispositivo, la vista no muestra el panorama de otro proyecto: dice
  «Opening project “ERSO”…» mientras no terminó una vuelta con el servidor (un dispositivo nuevo puede estar bajándolo) y
  después «“ERSO” isn’t a project you can see here. Ask for access, or check you’re in its workspace.». Con dos que
  coinciden: «“ERSO” matches more than one project: ERSO | Serie · ERSO (copia). Open the one you want from the project
  list.». El valor del link se muestra entre comillas y recortado a 40 caracteres (`shownParam`), para que no se lea como
  un texto de la app. Mientras tanto, el título de la pestaña y la barra siguen en el proyecto elegido antes (no se
  muestra nada de él en el centro).
- **Si la escena no existe** en ese proyecto, el aviso nombra el proyecto: «101_099 isn’t a scene of ERSO | Serie.» (o,
  para quien ve solo una parte del proyecto, que no está en las páginas que ve, D401).
- **No da acceso.** Quien lo abre tiene que poder ver el proyecto con su cuenta. Sin sesión, la app pide entrar: con el
  código de 8 dígitos, en la misma pestaña, la dirección no se toca y sigue a la escena. El botón del correo, en cambio,
  vuelve al inicio (`emailRedirectTo` en `src/ui/Login.tsx` solo conserva la dirección de un archivo; pendiente en
  `Doc_Roadmap.md`, «Link a una escena»).
- **Sin red** funciona igual si el proyecto ya está en el dispositivo: todo se resuelve ahí. Si no está, sin red no hay
  forma de saber si existe: el error de red cuenta como vuelta terminada y dice que no lo ve.
- Un link público (`#link=`) no tiene Panorama (D495): esta dirección es solo para cuentas.

## *Copy link*

En la vista de una escena, al lado de *Export…*. Copia la dirección con el **id** del proyecto (no cambia si se lo
renombra), el número de la escena como se muestra y `w`. En una serie es la forma de la post (`scene=1013`, como la
nombran PipeSync y Flow; `sceneLabel` en `src/relations/reader.ts`); con dos episodios que terminan igual, o en un
largo, el número tal como lo tiene el proyecto (`101_013`, `074`). Aviso: «Link to scene 5027 copied».

No suma un paso a los recorridos: compartir no es parte de armar un proyecto, y la barra de la vista de escena (tampoco
*Export…*) no aparece en ninguno. Está en la ayuda, en «Every page about a scene».

## Código

| Pieza | Archivo |
|---|---|
| `PROJECT_PARAM`, `projectFromParam` (id, nombre, primera palabra; uno solo), `projectMatches`, `useProjectParam` (`none` / `found` / `ambiguous` / `missing`, solo en `/map`), `shownParam`, y `useCurrentProject`, que da el del link antes que el elegido | `src/ui/project.ts` |
| El proyecto del link queda elegido (`storeProject`); el aviso de proyecto ambiguo o que no está, con `lastSyncAt`/`lastError` de `useSyncStatus` para no afirmarlo antes de tiempo | `MapView` en `src/relations/MapView.tsx` |
| *Copy link* (`copyLink` en `SceneDetail`) | `src/relations/MapView.tsx` |
| La dirección (la escena con `sceneLabel`, v0.319) | `sceneShareLink` en `src/relations/sceneMentions.ts` |
| El `scene=` en cualquier forma (v0.319) | `resolveSceneParam` en `src/relations/sceneSearch.ts` (lo usan `MapView` y `OverviewNav`) |
| `w` también en `/map` | `computeStart` en `src/ui/App.tsx` |
| Textos | `map.copyLink`, `map.copyLinkTip`, `map.linkCopied`, `map.projectOpening`, `map.projectUnknown`, `map.projectAmbiguous`, `map.sceneUnknown` con `{project}` (`src/i18n/lazy/map.ts`); ayuda `help.scenesSection` (`src/i18n/lazy/help.ts`; sube a 0.317 en `src/help/entries.ts`, así sale en las novedades) |

## Pruebas

- `src/relations/sceneLink.test.tsx`: `projectFromParam` (id, nombre, primera palabra, tildes, ambiguos, ninguno);
  abrir `?project=ERSO&scene=5027` con otro proyecto elegido muestra 105_027 de ERSO y lo deja elegido también al salir;
  un proyecto que no está no muestra la escena de otro («Opening…» hasta la primera vuelta con el servidor, después que no
  lo ve); dos que coinciden se nombran y un valor largo se recorta; una escena que no está nombra el proyecto; `project`
  en una página no le gana a la página; *Copy link* copia `sceneShareLink(…)` y esa dirección, abierta con
  otro proyecto elegido, vuelve a la misma escena.
- `src/ui/pageLinkStart.test.ts`: `w` en `/map` elige su workspace, uno que no está va a la bienvenida sin crear ningún
  cliente, y sin `w` abre el de siempre.
- v0.319: `sceneLink.test.tsx` abre `105_027`, `5027`, `ERSO_5027_010` y `ERSO_105_027_010` y llega a la misma escena,
  y *Copy link* copia `scene=5027`; `sceneSearch.test.ts` prueba `resolveSceneParam` (también que con 101 y 201 no
  adivina); `scenesSection.test.tsx` suma los nombres de plano a las formas de la dirección.
