import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SupabasePingResult {
  connected: boolean;
  latencyMs: number;
  status: 'connected' | 'disconnected' | 'missing_tables';
  url?: string;
  source?: string;
  projectCount?: number;
  tables?: {
    projects: boolean;
    project_snapshots: boolean;
    weekly_deltas: boolean;
  };
  message?: string;
  error?: string | null;
}

export interface FirecrawlPingResult {
  connected: boolean;
  configured: boolean;
  latencyMs?: number;
  status: 'connected' | 'invalid_key' | 'unconfigured' | 'error';
  message?: string;
  error?: string | null;
  data?: any;
}

let cachedClient: SupabaseClient | null = null;
let cachedUrl = '';
let cachedKey = '';

/**
 * Creates or retrieves a cached Supabase client instance.
 */
export function getSupabaseClient(url?: string, key?: string): SupabaseClient | null {
  const targetUrl = url?.trim();
  const targetKey = key?.trim();

  if (!targetUrl || !targetKey) {
    return null;
  }

  if (cachedClient && cachedUrl === targetUrl && cachedKey === targetKey) {
    return cachedClient;
  }

  cachedClient = createClient(targetUrl, targetKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  cachedUrl = targetUrl;
  cachedKey = targetKey;
  return cachedClient;
}

/**
 * Verifies Supabase connection by attempting a lightweight ping to the database.
 * If url & key are passed, attempts a direct lightweight count query or tests the endpoint.
 * Otherwise, queries the backend status endpoint for active database verification.
 */
export async function verifySupabaseConnection(options?: {
  url?: string;
  key?: string;
}): Promise<SupabasePingResult> {
  const startTime = performance.now();

  try {
    // 1. If explicit URL and Key are provided (e.g. testing in form before saving)
    if (options?.url && options?.key) {
      const trimmedUrl = options.url.trim();
      const trimmedKey = options.key.trim();

      // Attempt lightweight ping via postgrest head request if valid format
      try {
        const client = getSupabaseClient(trimmedUrl, trimmedKey) || createClient(trimmedUrl, trimmedKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        // Lightweight ping: head: true only fetches headers and exact count, no rows payload
        const { error, count } = await client
          .from('projects')
          .select('id', { count: 'exact', head: true })
          .limit(1);

        const latencyMs = Math.round(performance.now() - startTime);

        if (error) {
          if (error.code === '42P01') {
            return {
              connected: true,
              latencyMs,
              status: 'missing_tables',
              url: trimmedUrl,
              projectCount: 0,
              tables: { projects: false, project_snapshots: false, weekly_deltas: false },
              message: "Database ping succeeded, but the 'projects' table is missing. Run the setup SQL script.",
              error: null
            };
          }

          return {
            connected: false,
            latencyMs,
            status: 'disconnected',
            url: trimmedUrl,
            error: error.message || 'Supabase query error'
          };
        }

        return {
          connected: true,
          latencyMs,
          status: 'connected',
          url: trimmedUrl,
          projectCount: count ?? 0,
          tables: { projects: true, project_snapshots: true, weekly_deltas: true },
          message: `Ping successful in ${latencyMs}ms (${count ?? 0} projects found).`,
          error: null
        };
      } catch (directErr: any) {
        // Fall back to server test route if browser direct fetch had CORS issues
        const res = await fetch('/api/supabase/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ supabaseUrl: trimmedUrl, supabaseKey: trimmedKey })
        });
        const data = await res.json();
        const latencyMs = Math.round(performance.now() - startTime);

        return {
          connected: !!data.connected,
          latencyMs,
          status: data.connected ? (data.tablesExist === false ? 'missing_tables' : 'connected') : 'disconnected',
          url: trimmedUrl,
          projectCount: data.count,
          tables: { projects: !!data.tablesExist, project_snapshots: false, weekly_deltas: false },
          message: data.message,
          error: data.connected ? null : (data.error || 'Connection failed')
        };
      }
    }

    // 2. Default: Ping current configured Supabase status from backend
    const res = await fetch('/api/supabase/status');
    const data = await res.json();
    const latencyMs = Math.round(performance.now() - startTime);

    if (data.connected && data.tables?.projects) {
      return {
        connected: true,
        latencyMs,
        status: 'connected',
        url: data.url,
        source: data.source,
        projectCount: data.projectCount,
        tables: data.tables,
        message: `Database ping active in ${latencyMs}ms (${data.projectCount ?? 0} project(s) ready).`,
        error: null
      };
    } else if (data.connected && !data.tables?.projects) {
      return {
        connected: true,
        latencyMs,
        status: 'missing_tables',
        url: data.url,
        source: data.source,
        projectCount: 0,
        tables: data.tables,
        message: "Connected to Supabase, but required tables are missing.",
        error: data.error
      };
    } else {
      return {
        connected: false,
        latencyMs,
        status: 'disconnected',
        url: data.url,
        source: data.source,
        tables: data.tables,
        error: data.error || 'Supabase is not reachable'
      };
    }
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - startTime);
    return {
      connected: false,
      latencyMs,
      status: 'disconnected',
      error: err.message || 'Failed to ping Supabase database'
    };
  }
}

/**
 * Verifies Firecrawl connection by attempting a lightweight API ping.
 */
export async function verifyFirecrawlConnection(apiKey?: string): Promise<FirecrawlPingResult> {
  const startTime = performance.now();
  try {
    const res = await fetch('/api/firecrawl/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey?.trim() || undefined })
    });
    const data = await res.json();
    const latencyMs = Math.round(performance.now() - startTime);

    if (data.status === 'unconfigured') {
      return {
        connected: false,
        configured: false,
        latencyMs,
        status: 'unconfigured',
        message: 'No Firecrawl API key provided. Automatic fallback scrapers will be used.',
        error: null
      };
    }

    if (data.success || data.connected) {
      return {
        connected: true,
        configured: true,
        latencyMs: data.latencyMs || latencyMs,
        status: 'connected',
        message: data.message || `Firecrawl ping successful in ${data.latencyMs || latencyMs}ms.`,
        data: data.data,
        error: null
      };
    }

    return {
      connected: false,
      configured: true,
      latencyMs: data.latencyMs || latencyMs,
      status: data.status === 'invalid_key' ? 'invalid_key' : 'error',
      error: data.error || 'Firecrawl connection failed'
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - startTime);
    return {
      connected: false,
      configured: !!apiKey,
      latencyMs,
      status: 'error',
      error: err.message || 'Failed to ping Firecrawl API'
    };
  }
}
