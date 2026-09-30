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
 * Automatically checks passed credentials, localStorage, or environment variables.
 */
export function getSupabaseClient(url?: string, key?: string): SupabaseClient | null {
  let targetUrl = (url || '').trim();
  let targetKey = (key || '').trim();

  // If not explicitly provided, check browser storage and env
  if (!targetUrl || !targetKey) {
    try {
      const storedUrl = localStorage.getItem('supabaseUrl');
      const storedKey = localStorage.getItem('supabaseKey');
      if (storedUrl && storedKey) {
        targetUrl = storedUrl.trim();
        targetKey = storedKey.trim();
      }
    } catch (_) {}
  }

  const metaEnv = (import.meta as any).env || {};
  if (!targetUrl || !targetKey) {
    targetUrl = (metaEnv.VITE_SUPABASE_URL || '').trim();
    targetKey = (metaEnv.VITE_SUPABASE_ANON_KEY || '').trim();
  }

  if (!targetUrl || !targetKey) {
    return null;
  }

  if (cachedClient && cachedUrl === targetUrl && cachedKey === targetKey) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(targetUrl, targetKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    cachedUrl = targetUrl;
    cachedKey = targetKey;
    return cachedClient;
  } catch (err) {
    console.warn('Failed to initialize Supabase client:', err);
    return null;
  }
}

/**
 * Verifies Supabase connection by attempting a lightweight ping to the database.
 * First tries direct browser client ping (most reliable across all hosting types),
 * then falls back to backend status endpoint.
 */
export async function verifySupabaseConnection(options?: {
  url?: string;
  key?: string;
}): Promise<SupabasePingResult> {
  const startTime = performance.now();

  const metaEnv = (import.meta as any).env || {};
  const targetUrl = (options?.url || localStorage.getItem('supabaseUrl') || metaEnv.VITE_SUPABASE_URL || '').trim();
  const targetKey = (options?.key || localStorage.getItem('supabaseKey') || metaEnv.VITE_SUPABASE_ANON_KEY || '').trim();

  // 1. Direct browser client ping if URL and Key are available
  if (targetUrl && targetKey) {
    try {
      const client = getSupabaseClient(targetUrl, targetKey) || createClient(targetUrl, targetKey, {
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
            url: targetUrl,
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
          url: targetUrl,
          error: error.message || 'Supabase query error'
        };
      }

      return {
        connected: true,
        latencyMs,
        status: 'connected',
        url: targetUrl,
        projectCount: count ?? 0,
        tables: { projects: true, project_snapshots: true, weekly_deltas: true },
        message: `Ping successful in ${latencyMs}ms (${count ?? 0} projects found).`,
        error: null
      };
    } catch (directErr: any) {
      console.warn('Direct Supabase ping failed, checking backend status:', directErr.message);
    }
  }

  // 2. Query backend status endpoint (using safe parsing so HTML responses don't throw)
  try {
    const res = await fetch('/api/supabase/status');
    const text = await res.text();
    const latencyMs = Math.round(performance.now() - startTime);

    if (text.trim().startsWith('<') || res.headers.get('content-type')?.includes('text/html')) {
      // Backend returned HTML (e.g. static site hosting in Coolify)
      if (targetUrl && targetKey) {
        return {
          connected: true,
          latencyMs,
          status: 'connected',
          url: targetUrl,
          message: 'Client connected directly to Supabase Cloud.',
          error: null
        };
      }
      return {
        connected: false,
        latencyMs,
        status: 'disconnected',
        error: 'No Supabase credentials configured yet.'
      };
    }

    const data = JSON.parse(text);

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
 * Verifies Firecrawl connection with direct browser test fallback.
 */
export async function verifyFirecrawlConnection(apiKey?: string): Promise<FirecrawlPingResult> {
  const startTime = performance.now();
  const key = (apiKey || localStorage.getItem('firecrawlApiKey') || '').trim();

  if (!key) {
    return {
      connected: false,
      configured: false,
      latencyMs: 0,
      status: 'unconfigured',
      message: 'No Firecrawl API key provided. Automatic fallback scrapers will be used.',
      error: null
    };
  }

  // 1. Try server endpoint
  try {
    const res = await fetch('/api/firecrawl/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });

    const text = await res.text();
    const isHtml = text.trim().startsWith('<') || res.headers.get('content-type')?.includes('text/html');

    if (!isHtml) {
      const data = JSON.parse(text);
      const latencyMs = Math.round(performance.now() - startTime);

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
      if (data.status === 'invalid_key') {
        return {
          connected: false,
          configured: true,
          latencyMs: data.latencyMs || latencyMs,
          status: 'invalid_key',
          error: data.error || 'Invalid Firecrawl API key.'
        };
      }
    }
  } catch (_) {}

  // 2. Direct browser ping to Firecrawl API
  try {
    const directRes = await fetch('https://api.firecrawl.dev/v1/team/credit-usage', {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    const latencyMs = Math.round(performance.now() - startTime);

    if (directRes.ok) {
      const usageData = await directRes.json().catch(() => ({}));
      return {
        connected: true,
        configured: true,
        latencyMs,
        status: 'connected',
        message: `Firecrawl API verified in ${latencyMs}ms.`,
        data: usageData?.data || usageData,
        error: null
      };
    } else if (directRes.status === 401 || directRes.status === 403) {
      return {
        connected: false,
        configured: true,
        latencyMs,
        status: 'invalid_key',
        error: 'Invalid Firecrawl API key (401 Unauthorized).'
      };
    } else {
      return {
        connected: false,
        configured: true,
        latencyMs,
        status: 'error',
        error: `Firecrawl returned status ${directRes.status}.`
      };
    }
  } catch (directErr: any) {
    const latencyMs = Math.round(performance.now() - startTime);
    return {
      connected: false,
      configured: true,
      latencyMs,
      status: 'error',
      error: directErr.message || 'Network error reaching Firecrawl.'
    };
  }
}
