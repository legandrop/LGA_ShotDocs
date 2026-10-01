import { useEffect, useState } from 'react';
import { pendingInviteTarget } from '../invite';
import { useServices } from '../services';
import { lazyPart, Part } from '../ui/lazyPart';
import { ACCOUNT_MARK, decideStart, dismissTour, offerTour, readDeviceTour, setAccountMarker, startTour, syncAccountMark, useTourUi } from './tourState';

// Lo de la recorrida que va en la primera carga (Docs/Doc_Tutorial.md, sección 4): decide al abrir si arranca, si
// ofrece retomarla o la tarjeta de primera vez, y anota en la cuenta que ya se vio. El motor se baja solo cuando
// hay algo para mostrar.

const TourLayer = lazyPart(() => import('./TourLayer').then((m) => m.TourLayer));

export function TourHost() {
  const services = useServices();
  const { client, workspace } = services;
  const tour = useTourUi();
  // Cómo se abrió la app, antes de que el inicio salte a la última página o el link de invitación se use.
  const [opened] = useState(() => ({
    atHome: location.pathname === '/',
    invite: !!pendingInviteTarget(workspace.config.storage.inviteTarget),
  }));

  // "Ya la vi" en la cuenta: en los metadatos del usuario de Supabase Auth del workspace (corrección 12). Sin red
  // queda para después: se vuelve a probar al abrir la app y al volver la red.
  useEffect(() => {
    setAccountMarker(async () => {
      const { error } = await client.auth.updateUser({ data: { [ACCOUNT_MARK]: 1 } });
      return !error;
    });
    void syncAccountMark();
    const online = () => void syncAccountMark();
    window.addEventListener('online', online);
    return () => {
      setAccountMarker(null);
      window.removeEventListener('online', online);
    };
  }, [client]);

  // Qué mostrar al abrir: una vez por instancia de servicios (cada workspace y cada sesión).
  useEffect(() => {
    let live = true;
    void (async () => {
      let accountSeen = false;
      try {
        // La sesión guardada en el dispositivo (sin red): trae los metadatos del usuario.
        const { data } = await client.auth.getSession();
        accountSeen = !!data.session?.user?.user_metadata?.[ACCOUNT_MARK];
      } catch {
        // Sin sesión legible, solo cuenta el dispositivo.
      }
      if (!live) return;
      const mode = decideStart({ firstLoad: !!services.firstLoad, ...opened, device: readDeviceTour(), accountSeen });
      if (mode === 'running') startTour();
      else if (mode !== 'off') offerTour(mode);
    })();
    return () => {
      live = false;
      // Salir de la sesión o cambiar de workspace: lo que estaba a la vista se va (el paso queda en el dispositivo).
      dismissTour();
    };
  }, [services]);

  if (tour.mode === 'off') return null;
  return (
    <Part>
      <TourLayer />
    </Part>
  );
}
