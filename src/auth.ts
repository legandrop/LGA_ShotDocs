import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { AUTH_STORAGE_KEY, supabase } from './supabase';

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: AuthUser };

const LAST_USER_KEY = 'shotdocs-last-user';

function readLastUser(): AuthUser | null {
  try {
    if (!localStorage.getItem(AUTH_STORAGE_KEY)) return null;
    const raw = localStorage.getItem(LAST_USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function userFrom(session: Session | null): AuthUser | null {
  return session?.user ? { id: session.user.id, email: session.user.email ?? '' } : null;
}

/**
 * Sin red, Supabase no puede renovar una sesión vencida y la informa vacía, pero la deja guardada. En
 * ese caso se sigue con el último usuario conocido: la app funciona offline y la sesión se renueva sola
 * cuando vuelve la red. Si Supabase la invalida de verdad, avisa con SIGNED_OUT.
 */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const user = userFrom(session);
      if (user) {
        try {
          localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
        } catch {
          // Sin almacenamiento solo se pierde el modo offline.
        }
        setState((prev) =>
          prev.status === 'signedIn' && prev.user.id === user.id ? prev : { status: 'signedIn', user },
        );
      } else if (event === 'SIGNED_OUT') {
        try {
          localStorage.removeItem(LAST_USER_KEY);
        } catch {
          // Nada que limpiar.
        }
        setState({ status: 'signedOut' });
      } else if (event === 'INITIAL_SESSION') {
        const last = readLastUser();
        setState(last ? { status: 'signedIn', user: last } : { status: 'signedOut' });
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return state;
}
