import { describe, expect, it } from 'vitest';
import { t, translate } from '../i18n';
import { teamErrorText } from '../ui/teamText';
import { acceptInvitationsQuietly } from './access';
import { FakeRemote, FakeServer } from './testing';

// La versión mínima de la app también frena compartir e invitar (supabase/migrations/20261106120000_version_minima_equipo.sql):
// los triggers de `grants`, `members` e `invitations` rechazan con el mismo 503 `app_outdated` que el árbol y los
// comentarios. El servidor en memoria sigue esa regla (`FakeServer.teamWriteVersion`).

/** Un workspace con equipo, una página y una mínima de 0.500: la dueña, una admin, un miembro y una invitada. */
function workspace() {
  const server = new FakeServer();
  server.enableTeam();
  const page = crypto.randomUUID();
  const now = new Date().toISOString();
  server.pages.set(page, {
    id: page,
    workspace_id: server.workspaceId,
    parent_id: null,
    title: 'Carpeta',
    icon: null,
    sort_key: 'a0',
    settings: {},
    update_seq: 0,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  });
  server.addMember('ada', 'admin', 'ada@test');
  server.addMember('max', 'member', 'max@test');
  server.addMember('gil', 'guest', 'gil@test');
  server.settings = { ...server.settings!, minAppVersion: 0.5 };
  const as = (version: string, user = server.ownerId, header = true) => {
    const remote = new FakeRemote(server, version, user);
    remote.versionHeader = header;
    return remote;
  };
  /** Todo lo que estas funciones escriben. */
  const print = () =>
    JSON.stringify([server.grants, [...server.members], server.invitations, [...server.cleanMeta]]);
  return { server, page, as, print };
}

const outdated = { message: 'app_outdated', permanent: false };

describe('compartir e invitar con una app más vieja que la mínima', () => {
  it('nada escribe: compartir, sacar un permiso, invitar, revocar, cambiar un rol, sacar a alguien y aceptar una invitación', async () => {
    const { server, page, as, print } = workspace();
    const current = as('0.500');
    const grant = await current.share('max', { pageId: page }, 'edit');
    const invitation = await current.createInvitation('nueva@test', 'member', [{ page_id: page, level: 'comment' }]);
    // Con contenido subido después: si un rechazo dejara hecho el reinicio de la rama (va antes de escribir), se nota.
    server.pages.get(page)!.update_seq = 3;
    const before = print();

    for (const old of [as('0.499'), as('abc'), as('0.300', server.ownerId, false)]) {
      await expect(old.share('gil', { pageId: page }, 'view')).rejects.toMatchObject(outdated);
      await expect(old.share('max', { pageId: page }, 'view')).rejects.toMatchObject(outdated);
      await expect(old.share('gil', { projectId: server.workspaceId }, 'comment')).rejects.toMatchObject(outdated);
      await expect(old.unshare(grant)).rejects.toMatchObject(outdated);
      await expect(old.createInvitation('otra@test', 'guest', [{ page_id: page, level: 'view' }])).rejects.toMatchObject(outdated);
      await expect(old.createInvitation('nueva@test', 'member', [])).rejects.toMatchObject(outdated);
      await expect(old.revokeInvitation(invitation)).rejects.toMatchObject(outdated);
      await expect(old.setMemberRole('max', 'guest')).rejects.toMatchObject(outdated);
      await expect(old.removeMember('max')).rejects.toMatchObject(outdated);
      expect(print()).toBe(before);
    }
    // Quien fue invitada y abre una app vieja: no entra hasta actualizar, y entrar no se corta por eso.
    const invited = new FakeRemote(server, '0.499', 'nueva', 'nueva@test');
    await expect(invited.acceptInvitations()).rejects.toMatchObject(outdated);
    expect(await acceptInvitationsQuietly(invited)).toBe(0);
    expect(print()).toBe(before);
  });

  it('repetir lo que ya está hecho no escribe y sigue andando; leer también', async () => {
    const { server, page, as, print } = workspace();
    const current = as('0.500');
    const grant = await current.share('max', { pageId: page }, 'edit');
    const invitation = await current.createInvitation('nueva@test', 'member', []);
    await current.revokeInvitation(invitation);
    const before = print();
    const old = as('0.499');
    expect(await old.share('max', { pageId: page }, 'edit')).toBe(grant);
    await old.revokeInvitation(invitation);
    await old.setMemberRole('max', 'member');
    expect(await new FakeRemote(server, '0.499', 'ada', 'ada@test').acceptInvitations()).toBe(0);
    expect((await old.listMembers()).length).toBe(4);
    expect((await old.listAccess({ pageId: page })).length).toBeGreaterThan(0);
    expect(print()).toBe(before);
  });

  it('el permiso va antes que la versión', async () => {
    const { page, as, print } = workspace();
    const before = print();
    const member = as('0.499', 'max');
    await expect(member.share('gil', { pageId: page }, 'view')).rejects.toMatchObject({ message: 'not_allowed', permanent: true });
    await expect(member.createInvitation('otra@test', 'guest', [])).rejects.toMatchObject({ message: 'not_allowed' });
    await expect(member.removeMember('gil')).rejects.toMatchObject({ message: 'not_allowed' });
    await expect(as('0.499', 'ada').setMemberRole('max', 'admin')).rejects.toMatchObject({ message: 'not_allowed' });
    expect(print()).toBe(before);
  });

  it('la mínima y las mayores escriben todo', async () => {
    const { server, page, as } = workspace();
    const current = as('0.500');
    const grant = await current.share('max', { pageId: page }, 'edit');
    await current.share('max', { pageId: page }, 'view');
    expect(server.grants.find((g) => g.id === grant)?.level).toBe('view');
    await current.unshare(grant);
    expect(server.grants).toEqual([]);
    const invitation = await as('1.200').createInvitation('nueva@test', 'member', [{ page_id: page, level: 'comment' }]);
    expect(await new FakeRemote(server, '0.500', 'nueva', 'nueva@test').acceptInvitations()).toBe(1);
    expect(server.role('nueva')).toBe('member');
    expect(server.invitations.find((i) => i.id === invitation)?.used_at).toBeTruthy();
    await current.setMemberRole('max', 'guest');
    expect(server.role('max')).toBe('guest');
    await current.removeMember('max');
    expect(server.role('max')).toBeNull();
  });

  it('una base sin la migración no frena compartir ni invitar (como hasta ahora)', async () => {
    const { server, page, as } = workspace();
    server.teamWriteVersion = false;
    const old = as('0.499');
    const grant = await old.share('max', { pageId: page }, 'edit');
    await old.unshare(grant);
    await old.revokeInvitation(await old.createInvitation('nueva@test', 'member', []));
    await old.setMemberRole('max', 'guest');
    await old.removeMember('max');
    expect(server.role('max')).toBeNull();
  });

  it('sin header (una versión anterior a la que lo manda): se rechaza solo con una mínima que ya lo exige', async () => {
    const { server, page, as } = workspace();
    // Una mínima más baja que la primera versión con header: quien no lo manda puede ser una versión permitida.
    server.settings = { ...server.settings!, minAppVersion: 0.05 };
    await as('0.060', server.ownerId, false).share('max', { pageId: page }, 'edit');
    expect(server.grants).toHaveLength(1);
    await expect(as('0.040').share('gil', { pageId: page }, 'view')).rejects.toMatchObject(outdated);
  });
});

describe('el aviso en Share y Members', () => {
  it('dice que hace falta una versión más nueva, en palabras', async () => {
    const { page, as } = workspace();
    const error = await as('0.499')
      .share('gil', { pageId: page }, 'view')
      .catch((err: unknown) => err);
    expect(teamErrorText(error)).toBe(t('common.appOutdated'));
    expect(translate('en', 'common.appOutdated')).toBe('This workspace needs a newer version of the app. Reload the app to update it and try again.');
    expect(translate('es', 'common.appOutdated')).toContain('Recargá la app');
  });
});
