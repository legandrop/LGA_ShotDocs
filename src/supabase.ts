import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const AUTH_STORAGE_KEY = 'shotdocs-auth';

const url = __SUPABASE_URL__;
const key = __SUPABASE_PUBLISHABLE_KEY__;

export const projectRef = /^https:\/\/([^.]+)\./.exec(url)?.[1] ?? 'local';

/** `null` si faltan SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY al compilar. */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          storageKey: AUTH_STORAGE_KEY,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'implicit',
        },
      })
    : null;
