import { type Translate } from '../i18n';
import '../i18n/lazy/assistant';
import { ProviderError } from './providers';

// El texto de un error del proveedor, para el panel del asistente, sus ajustes y *Dictate to report* (aparte, así la
// hoja del dictado no baja el panel entero).

export function errorText(err: unknown, provider: string, tr: Translate): string {
  if (!(err instanceof ProviderError)) return tr('assistant.error.other', { provider, message: String((err as Error)?.message ?? err) });
  switch (err.kind) {
    case 'workspace':
      return tr(err.message === 'workspace_session' ? 'assistant.nvidia.session' : err.message === 'workspace_policy' ? 'assistant.nvidia.policy' : err.message === 'workspace_page' ? 'assistant.nvidia.page' : err.message === 'gateway_outdated' ? 'assistant.nvidia.outdated' : err.message === 'nvidia_pending' ? 'assistant.nvidia.pending' : 'assistant.nvidia.unavailable');
    case 'auth':
      return tr('assistant.error.auth', { provider });
    case 'forbidden':
      return tr('assistant.error.forbidden', { provider, message: err.message });
    case 'rateLimit':
      return err.retryAfter !== null ? tr('assistant.error.rateLimitIn', { seconds: err.retryAfter }) : tr('assistant.error.rateLimit');
    case 'spendTier':
      return tr('assistant.error.spendTier', { provider });
    case 'spendOwn':
      return tr('assistant.error.spendOwn', { provider });
    case 'model':
      return tr('assistant.error.model', { message: err.message });
    case 'network':
      return tr('assistant.error.network', { provider });
    case 'server':
      return tr('assistant.error.server', { provider, message: err.message });
    case 'aborted':
      return tr('assistant.stopped');
    default:
      return tr('assistant.error.other', { provider, message: err.message });
  }
}
