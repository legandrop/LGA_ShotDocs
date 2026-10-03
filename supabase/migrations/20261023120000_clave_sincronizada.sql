-- La clave del asistente sincronizada entre los dispositivos de una persona (Docs/Doc_Clave_Sincronizada.md, entrega
-- S1; D72 → B). La clave se cifra EN EL DISPOSITIVO con una frase que solo sabe la persona (PBKDF2-SHA256 de 1 000 000
-- de vueltas y AES-256-GCM, src/assistant/keySync.ts): acá llega solo el bloque cifrado, de largo fijo. Los parámetros
-- del cifrado los fija la app por versión (`format`), nunca la fila: por eso la tabla no tiene columnas de vueltas ni
-- de algoritmo. El proveedor y la dirección viajan adentro del cifrado.
--
-- Una fila por persona. Con Row Level Security la lee, la crea, la cambia y la borra solo ella, con una sesión de la
-- app: nunca otro miembro ni el dueño desde la app, nunca `anon`, nunca un token de un cliente MCP (`client_id`, ver
-- Docs/Doc_Asistente.md 9.2) y nunca una sesión abierta con contraseña (`private.session_allowed()`). El dueño del
-- Supabase ve la fila desde su panel (es su base): que existe, cuándo cambió y el bloque cifrado. Nada más.
--
-- `generation` la sube el trigger en cada cambio: la app escribe con `update … where generation = <la que leyó>` y así
-- dos dispositivos no se pisan. El id lo pone la base (`auth.uid()`) y no cambia nunca.
--
-- *Stop syncing* hace un `delete` de verdad (CS8): es un secreto de la persona, no contenido de las páginas.
--
-- Fuera de Realtime (no se suma a la publicación) y fuera del portero. No sube `schema_version`: sin la tabla,
-- PostgREST contesta que no existe y la app dice que la base del workspace necesita una actualización. Compatible con
-- la app y el portero publicados: una tabla nueva que nadie usa todavía.

create table public.assistant_key_sync (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  format     smallint not null check (format = 1),
  salt       text not null check (length(salt) = 24),         -- 16 bytes en base64
  iv         text not null check (length(iv) = 16),           -- 12 bytes en base64
  ciphertext text not null check (length(ciphertext) = 1388), -- 1 024 + 16 bytes en base64
  generation bigint not null default 1,
  updated_at timestamptz not null default now()
);

comment on table public.assistant_key_sync is
  'La clave del asistente de cada persona, cifrada en su dispositivo con su frase. Docs/Doc_Clave_Sincronizada.md.';

alter table public.assistant_key_sync enable row level security;

-- Solo la persona, con una sesión de la app (sin contraseña) y nunca con el token de un cliente MCP.
create policy assistant_key_sync_own on public.assistant_key_sync
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and (select auth.jwt() ->> 'client_id') is null
    and (select private.session_allowed())
  )
  with check (
    user_id = (select auth.uid())
    and (select auth.jwt() ->> 'client_id') is null
    and (select private.session_allowed())
  );

revoke all on public.assistant_key_sync from public, anon, authenticated;
grant select, delete on public.assistant_key_sync to authenticated;
grant insert (format, salt, iv, ciphertext) on public.assistant_key_sync to authenticated;
grant update (format, salt, iv, ciphertext) on public.assistant_key_sync to authenticated;

-- Cada cambio sube `generation` y la hora; el id no cambia.
create function private.assistant_key_sync_touch()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.user_id := old.user_id;
  new.generation := old.generation + 1;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.assistant_key_sync_touch() from public, anon, authenticated;

create trigger assistant_key_sync_touch before update on public.assistant_key_sync
  for each row execute function private.assistant_key_sync_touch();

notify pgrst, 'reload schema';
