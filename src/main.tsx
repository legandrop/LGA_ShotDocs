import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { prefs } from './prefs';
import { App } from './ui/App';
import { AppBarrier } from './ui/ErrorBarrier';
import { listenForInstallPrompt } from './ui/install';
import { listenForMissingFiles } from './ui/lazyPart';
import { watchNewVersionFromStart } from './ui/appUpdate';
// Los estilos del editor van con la primera pantalla aunque el editor se baje aparte (roadmap B.4): así
// quedan antes de styles.css, que los ajusta, como antes. Cargados con el editor irían después y le
// ganarían a esos ajustes.
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import './ui/drive.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/courier-prime/latin-400.css';
import '@fontsource/courier-prime/latin-700.css';
import './styles.css';

prefs.init();
// Un archivo de la versión vieja que ya no está (se publicó una nueva): recargar una vez (lazyPart.tsx).
listenForMissingFiles();
// Una versión nueva que toma el control de la pestaña antes de entrar a un workspace también cuenta (appUpdate.ts).
watchNewVersionFromStart();
// Chrome y Edge ofrecen instalar enseguida al cargar: se guarda para el botón "Install" (install.ts).
listenForInstallPrompt();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Lo que se escape de las barreras de adentro: una pantalla con *Reload*, nunca en blanco (ErrorBarrier.tsx). */}
    <AppBarrier>
      <App />
    </AppBarrier>
  </StrictMode>,
);
