import { comments } from './comments';
import { common } from './common';
import { login } from './login';
import { link } from './link';
import { media } from './media';
import { menus } from './menus';
import { page } from './page';
import { print } from './print';
import { shell } from './shell';
import { sidebar } from './sidebar';
import { space } from './space';
import { sync } from './sync';
import { team } from './team';
import { trash } from './trash';
import { workspaces } from './workspaces';

// Todas las claves, por parte de la app. Una clave va en una sola parte (la prueba revisa que ninguna se
// repita entre partes, que las dos lenguas tengan los mismos `{valores}` y que no sobre ninguna).
export const parts = { common, shell, sidebar, menus, page, comments, team, trash, workspaces, login, media, sync, print, space, link };

export const strings = {
  ...common,
  ...shell,
  ...sidebar,
  ...menus,
  ...page,
  ...comments,
  ...team,
  ...trash,
  ...workspaces,
  ...login,
  ...media,
  ...sync,
  ...print,
  ...space,
  ...link,
};
