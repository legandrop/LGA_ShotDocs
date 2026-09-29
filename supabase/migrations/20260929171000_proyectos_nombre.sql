-- LGA Shot Docs · proyectos: el primer proyecto de cada usuario se creaba con el nombre "Mis documentos",
-- en castellano, que ahora se ve en la interfaz (en inglés). Los que nadie renombró pasan al nombre nuevo
-- de fábrica.
update public.workspaces set name = 'My project' where name = 'Mis documentos';
