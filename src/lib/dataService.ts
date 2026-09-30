import { getSupabaseClient, SupabasePingResult, FirecrawlPingResult } from './supabase';

export interface Project {
  id: string;
  name: string;
  location: string | null;
  official_url: string | null;
  rera_registration_number: string | null;
  created_at?: string;
}

export interface Snapshot {
  id: string;
  project_id: string;
  scraped_at: string;
  no_of_units: number | null;
  no_of_floors: number | null;
  land_area_acres: number | null;
  base_price_per_sft: number | null;
  landed_price_per_sft: number | null;
  construction_stage: string | null;
  handover_date: string | null;
  schemes: string[] | null;
  social_ads_summary: string | null;
  created_at?: string;
}

export interface WeeklyDelta {
  id: string;
  project_id: string;
  change_type: string;
  description: string;
  created_at?: string;
}

export interface AppSettings {
  supabaseUrl?: string;
  supabaseKey?: string;
  firecrawlApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  llmApiKey?: string;
  geminiApiKey?: string;
  openaiApiKey?: string;
  reraSites?: string;
  effectiveSupabaseUrl?: string;
  supabaseSource?: string;
  supabaseEnvSet?: boolean;
}

const SETTINGS_STORAGE_KEY = 'realintel_settings';
const CACHE_PROJECTS_KEY = 'cached_projects';
const CACHE_SNAPSHOTS_KEY = 'cached_snapshots_latest';
const CACHE_DELTAS_KEY = 'cached_weekly_deltas';
const CACHE_WEEKLY_UPDATES_KEY = 'cached_weekly_updates';

/**
 * Safely parses response without ever throwing unexpected HTML/token errors.
 */
export async function safeFetchJson(res: Response): Promise<{ ok: boolean; status: number; data: any; isHtml: boolean }> {
  try {
    const text = await res.text();
    const isHtml = text.trim().startsWith('<') || (res.headers.get('content-type')?.includes('text/html') ?? false);
    if (isHtml) {
      return { ok: false, status: res.status, data: null, isHtml: true };
    }
    const data = JSON.parse(text);
    return { ok: res.ok, status: res.status, data, isHtml: false };
  } catch (err) {
    return { ok: false, status: res.status, data: null, isHtml: false };
  }
}

/**
 * Robust JSON extraction from LLM output (stripping thinking blocks, code fences, etc.)
 */
export function parseJsonSafely(text: string): any {
  if (!text) throw new Error("Empty LLM response");
  let cleaned = text.trim();

  // Strip <think>...</think> reasoning tags
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Strip Markdown code blocks
  if (cleaned.includes('```')) {
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match && match[1]) {
      cleaned = match[1].trim();
    }
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Try finding the outermost JSON object { ... } or array [ ... ]
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
      } catch (_) {}
    }

    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(cleaned.substring(firstBracket, lastBracket + 1));
      } catch (_) {}
    }

    throw new Error(`Failed to parse extracted JSON: ${cleaned.slice(0, 150)}`);
  }
}

/**
 * Get current settings from localStorage and environment
 */
export function getLocalSettings(): AppSettings {
  let settings: AppSettings = {};
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      settings = JSON.parse(stored);
    }
  } catch (_) {}

  // Merge individual localStorage items for backward compatibility
  const sbUrl = localStorage.getItem('supabaseUrl');
  const sbKey = localStorage.getItem('supabaseKey');
  const fcKey = localStorage.getItem('firecrawlApiKey');
  const llmBase = localStorage.getItem('llmBaseUrl');
  const llmMod = localStorage.getItem('llmModel');
  const llmKey = localStorage.getItem('llmApiKey');

  if (sbUrl && !settings.supabaseUrl) settings.supabaseUrl = sbUrl;
  if (sbKey && !settings.supabaseKey) settings.supabaseKey = sbKey;
  if (fcKey && !settings.firecrawlApiKey) settings.firecrawlApiKey = fcKey;
  if (llmBase && !settings.llmBaseUrl) settings.llmBaseUrl = llmBase;
  if (llmMod && !settings.llmModel) settings.llmModel = llmMod;
  if (llmKey && !settings.llmApiKey) settings.llmApiKey = llmKey;

  // Environment fallback
  const metaEnv = (import.meta as any).env || {};
  if (!settings.supabaseUrl && metaEnv.VITE_SUPABASE_URL) {
    settings.supabaseUrl = metaEnv.VITE_SUPABASE_URL;
  }
  if (!settings.supabaseKey && metaEnv.VITE_SUPABASE_ANON_KEY) {
    settings.supabaseKey = metaEnv.VITE_SUPABASE_ANON_KEY;
  }

  return settings;
}

/**
 * Save settings locally and notify server if available
 */
export async function saveAppSettings(newSettings: Partial<AppSettings>): Promise<{ success: boolean; syncedWithServer: boolean }> {
  const current = getLocalSettings();
  const merged: AppSettings = { ...current, ...newSettings };

  // Always persist locally
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
    if (merged.supabaseUrl !== undefined) localStorage.setItem('supabaseUrl', merged.supabaseUrl || '');
    if (merged.supabaseKey !== undefined) localStorage.setItem('supabaseKey', merged.supabaseKey || '');
    if (merged.firecrawlApiKey !== undefined) localStorage.setItem('firecrawlApiKey', merged.firecrawlApiKey || '');
    if (merged.llmBaseUrl !== undefined) localStorage.setItem('llmBaseUrl', merged.llmBaseUrl || '');
    if (merged.llmModel !== undefined) localStorage.setItem('llmModel', merged.llmModel || '');
    if (merged.llmApiKey !== undefined) localStorage.setItem('llmApiKey', merged.llmApiKey || '');
  } catch (e) {
    console.warn('Failed to save settings to localStorage:', e);
  }

  // Attempt server sync
  let synced = false;
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merged)
    });
    const parsed = await safeFetchJson(res);
    synced = parsed.ok && !parsed.isHtml;
  } catch (_) {
    synced = false;
  }

  return { success: true, syncedWithServer: synced };
}

/**
 * Fetch settings: tries server first, falls back to localStorage
 */
export async function loadAppSettings(): Promise<AppSettings> {
  const local = getLocalSettings();
  try {
    const res = await fetch('/api/settings');
    const parsed = await safeFetchJson(res);
    if (parsed.ok && !parsed.isHtml && parsed.data) {
      const serverData = parsed.data;
      const merged = { ...local, ...serverData };
      if (!serverData.supabaseUrl && local.supabaseUrl) merged.supabaseUrl = local.supabaseUrl;
      if (!serverData.supabaseKey && local.supabaseKey) merged.supabaseKey = local.supabaseKey;
      return merged;
    }
  } catch (_) {}
  return local;
}

/**
 * Get active Supabase client instance
 */
export function getActiveSupabaseClient() {
  const settings = getLocalSettings();
  return getSupabaseClient(settings.supabaseUrl, settings.supabaseKey);
}

// ==========================================
// Projects Service (Dual-Resilient Engine)
// ==========================================

export async function getProjects(): Promise<Project[]> {
  const supabase = getActiveSupabaseClient();

  // 1. Direct Supabase query (Preferred in production and local when configured)
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        try {
          localStorage.setItem(CACHE_PROJECTS_KEY, JSON.stringify(data));
        } catch (_) {}
        return data as Project[];
      } else if (error) {
        console.warn('Supabase query error, trying API fallback:', error.message);
      }
    } catch (e: any) {
      console.warn('Supabase client exception, trying API fallback:', e.message);
    }
  }

  // 2. Server API fallback
  try {
    const res = await fetch('/api/projects');
    const parsed = await safeFetchJson(res);
    if (parsed.ok && !parsed.isHtml && Array.isArray(parsed.data)) {
      try {
        localStorage.setItem(CACHE_PROJECTS_KEY, JSON.stringify(parsed.data));
      } catch (_) {}
      return parsed.data as Project[];
    }
  } catch (apiErr) {
    console.warn('API /api/projects unreachable, checking localStorage cache');
  }

  // 3. LocalStorage cached fallback
  try {
    const cached = localStorage.getItem(CACHE_PROJECTS_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}

  return [];
}

export async function addProject(project: {
  name: string;
  location?: string | null;
  official_url?: string | null;
  rera_registration_number?: string | null;
}): Promise<Project> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const newProject: Project = {
    id,
    name: project.name.trim(),
    location: project.location?.trim() || null,
    official_url: project.official_url?.trim() || null,
    rera_registration_number: project.rera_registration_number?.trim() || null,
    created_at: now
  };

  const supabase = getActiveSupabaseClient();
  let savedToSupabase = false;

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert([newProject])
        .select()
        .single();
      if (!error && data) {
        savedToSupabase = true;
      }
    } catch (e) {
      console.warn('Direct Supabase insert failed, attempting server API:', e);
    }
  }

  // Also notify server API if available
  try {
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProject)
    });
  } catch (_) {}

  // Update cached list in localStorage
  try {
    const current = await getProjects();
    const exists = current.some(p => p.id === id);
    if (!exists) {
      const updated = [newProject, ...current];
      localStorage.setItem(CACHE_PROJECTS_KEY, JSON.stringify(updated));
    }
  } catch (_) {}

  return newProject;
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<void> {
  const supabase = getActiveSupabaseClient();

  if (supabase) {
    try {
      await supabase
        .from('projects')
        .update(updates)
        .eq('id', id);
    } catch (e) {
      console.warn('Supabase update failed:', e);
    }
  }

  // Attempt server update
  try {
    await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
  } catch (_) {}

  // Update localStorage cache
  try {
    const cached = localStorage.getItem(CACHE_PROJECTS_KEY);
    if (cached) {
      const list: Project[] = JSON.parse(cached);
      const updated = list.map(p => p.id === id ? { ...p, ...updates } : p);
      localStorage.setItem(CACHE_PROJECTS_KEY, JSON.stringify(updated));
    }
  } catch (_) {}
}

export async function deleteProject(id: string): Promise<void> {
  const supabase = getActiveSupabaseClient();

  if (supabase) {
    try {
      await supabase.from('projects').delete().eq('id', id);
    } catch (e) {
      console.warn('Supabase delete failed:', e);
    }
  }

  // Attempt server delete
  try {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  } catch (_) {}

  // Update localStorage cache
  try {
    const cached = localStorage.getItem(CACHE_PROJECTS_KEY);
    if (cached) {
      const list: Project[] = JSON.parse(cached);
      const updated = list.filter(p => p.id !== id);
      localStorage.setItem(CACHE_PROJECTS_KEY, JSON.stringify(updated));
    }
  } catch (_) {}
}

// ==========================================
// Snapshots Service
// ==========================================

export async function getLatestSnapshots(): Promise<Snapshot[]> {
  const supabase = getActiveSupabaseClient();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('project_snapshots')
        .select('*')
        .order('scraped_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        const latest: Snapshot[] = [];
        const seen = new Set<string>();
        for (const row of data) {
          if (!seen.has(row.project_id)) {
            seen.add(row.project_id);
            latest.push({
              ...row,
              schemes: typeof row.schemes === 'string' ? JSON.parse(row.schemes || '[]') : (row.schemes || [])
            });
          }
        }
        try {
          localStorage.setItem(CACHE_SNAPSHOTS_KEY, JSON.stringify(latest));
        } catch (_) {}
        return latest;
      }
    } catch (e) {
      console.warn('Supabase snapshots query failed:', e);
    }
  }

  // Server API fallback
  try {
    const res = await fetch('/api/snapshots/latest');
    const parsed = await safeFetchJson(res);
    if (parsed.ok && !parsed.isHtml && Array.isArray(parsed.data)) {
      try {
        localStorage.setItem(CACHE_SNAPSHOTS_KEY, JSON.stringify(parsed.data));
      } catch (_) {}
      return parsed.data;
    }
  } catch (_) {}

  // LocalStorage fallback
  try {
    const cached = localStorage.getItem(CACHE_SNAPSHOTS_KEY);
    if (cached) return JSON.parse(cached);
  } catch (_) {}

  return [];
}

export async function getHistoricalSnapshots(): Promise<Snapshot[]> {
  const supabase = getActiveSupabaseClient();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('project_snapshots')
        .select('*')
        .order('scraped_at', { ascending: true });

      if (!error && Array.isArray(data)) {
        return data.map((row: any) => ({
          ...row,
          schemes: typeof row.schemes === 'string' ? JSON.parse(row.schemes || '[]') : (row.schemes || [])
        }));
      }
    } catch (e) {
      console.warn('Supabase historical snapshots query failed:', e);
    }
  }

  // API fallback
  try {
    const res = await fetch('/api/snapshots/history');
    const parsed = await safeFetchJson(res);
    if (parsed.ok && !parsed.isHtml && Array.isArray(parsed.data)) {
      return parsed.data;
    }
  } catch (_) {}

  return [];
}

// ==========================================
// Weekly Deltas Service
// ==========================================

export async function getWeeklyDeltas(): Promise<WeeklyDelta[]> {
  const supabase = getActiveSupabaseClient();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('weekly_deltas')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        try {
          localStorage.setItem(CACHE_DELTAS_KEY, JSON.stringify(data));
        } catch (_) {}
        return data;
      }
    } catch (e) {
      console.warn('Supabase deltas query failed:', e);
    }
  }

  // API fallback
  try {
    const res = await fetch('/api/deltas');
    const parsed = await safeFetchJson(res);
    if (parsed.ok && !parsed.isHtml && Array.isArray(parsed.data)) {
      try {
        localStorage.setItem(CACHE_DELTAS_KEY, JSON.stringify(parsed.data));
      } catch (_) {}
      return parsed.data;
    }
  } catch (_) {}

  // Local fallback
  try {
    const cached = localStorage.getItem(CACHE_DELTAS_KEY);
    if (cached) return JSON.parse(cached);
  } catch (_) {}

  return [];
}

// ==========================================
// Weekly Updates (Market Summaries)
// ==========================================

export async function getWeeklyUpdates(): Promise<any[]> {
  try {
    const res = await fetch('/api/weekly_updates');
    const parsed = await safeFetchJson(res);
    if (parsed.ok && !parsed.isHtml && Array.isArray(parsed.data)) {
      try {
        localStorage.setItem(CACHE_WEEKLY_UPDATES_KEY, JSON.stringify(parsed.data));
      } catch (_) {}
      return parsed.data;
    }
  } catch (_) {}

  try {
    const cached = localStorage.getItem(CACHE_WEEKLY_UPDATES_KEY);
    if (cached) return JSON.parse(cached);
  } catch (_) {}

  return [];
}

export async function saveWeeklyUpdate(data: any): Promise<void> {
  const timestamp = new Date().toISOString();
  const newEntry = { id: Date.now(), timestamp, data };

  // Update local storage
  try {
    const current = await getWeeklyUpdates();
    const updated = [newEntry, ...current];
    localStorage.setItem(CACHE_WEEKLY_UPDATES_KEY, JSON.stringify(updated));
  } catch (_) {}

  // Send to server
  try {
    await fetch('/api/weekly_updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    });
  } catch (_) {}
}

// ==========================================
// Intelligence Scraping with Client Fallback
// ==========================================

export async function scrapeProjectIntelligence(projectId: string): Promise<{ success: boolean; error?: string; extractedData?: any }> {
  // 1. First attempt the backend scrape route
  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId })
    });

    const parsed = await safeFetchJson(res);
    if (parsed.ok && !parsed.isHtml && parsed.data?.success) {
      return { success: true, extractedData: parsed.data.extractedData };
    }

    if (parsed.data?.error && !parsed.isHtml && res.status !== 405) {
      return { success: false, error: parsed.data.error };
    }
  } catch (_) {}

  // 2. Client-side fallback if server returned 405 (Static hosting) or failed
  console.log('Initiating client-side scraping fallback for project:', projectId);
  try {
    const projects = await getProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project || !project.official_url) {
      return { success: false, error: 'Project has no official URL configured to scrape.' };
    }

    const settings = getLocalSettings();
    let scrapedContent = '';

    // A. Firecrawl Direct Scrape if API key available
    if (settings.firecrawlApiKey) {
      try {
        const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.firecrawlApiKey.trim()}`
          },
          body: JSON.stringify({
            url: project.official_url,
            formats: ['markdown']
          })
        });
        if (fcRes.ok) {
          const fcData = await fcRes.json();
          scrapedContent = fcData.data?.markdown || '';
        }
      } catch (fcErr) {
        console.warn('Direct Firecrawl request failed, trying Jina fallback:', fcErr);
      }
    }

    // B. Jina Reader Direct Fallback (Supports CORS in all web browsers)
    if (!scrapedContent) {
      try {
        const jinaUrl = `https://r.jina.ai/${project.official_url}`;
        const jinaRes = await fetch(jinaUrl);
        if (jinaRes.ok) {
          scrapedContent = await jinaRes.text();
        }
      } catch (jinaErr) {
        console.warn('Jina fallback failed:', jinaErr);
      }
    }

    if (!scrapedContent || scrapedContent.length < 50) {
      return { success: false, error: 'Could not extract content from the project official URL.' };
    }

    // C. LLM Extraction (OpenRouter, OpenAI, or Gemini)
    const prompt = `You are a real estate intelligence expert analyzing competitor web pages.
Extract structured real estate data for project "${project.name}" located at "${project.location || 'Unknown'}".
Official URL: ${project.official_url}
RERA Number: ${project.rera_registration_number || 'N/A'}

SCRAPED CONTENT:
${scrapedContent.substring(0, 20000)}

Respond strictly with a single JSON object with these exact keys:
{
  "no_of_units": <integer or null>,
  "no_of_floors": <integer or null>,
  "land_area_acres": <number in acres or null>,
  "base_price_per_sft": <number or null>,
  "landed_price_per_sft": <number or null>,
  "construction_stage": <string description or null>,
  "handover_date": <string e.g. "Dec 2027" or null>,
  "schemes": <array of strings for offers/discounts/payment plans>,
  "social_ads_summary": <string marketing summary or null>
}`;

    const llmBaseUrl = (settings.llmBaseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    const llmKey = settings.llmApiKey || settings.geminiApiKey || '';
    const llmModel = settings.llmModel || 'google/gemini-2.5-flash';

    if (!llmKey) {
      return { success: false, error: 'No LLM API Key (OpenRouter/OpenAI/Gemini) configured in Settings.' };
    }

    const llmRes = await fetch(`${llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmKey.trim()}`
      },
      body: JSON.stringify({
        model: llmModel,
        messages: [
          { role: 'system', content: 'You are an expert real estate data extraction system that strictly returns valid JSON.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      return { success: false, error: `LLM API returned ${llmRes.status}: ${errText.slice(0, 100)}` };
    }

    const llmData = await llmRes.json();
    const rawContent = llmData.choices?.[0]?.message?.content || '{}';
    const extractedData = parseJsonSafely(rawContent);

    // Save snapshot
    const snapshotId = crypto.randomUUID();
    const now = new Date().toISOString();
    const snapshotRecord: Snapshot = {
      id: snapshotId,
      project_id: projectId,
      scraped_at: now,
      no_of_units: extractedData.no_of_units ?? null,
      no_of_floors: extractedData.no_of_floors ?? null,
      land_area_acres: extractedData.land_area_acres ?? null,
      base_price_per_sft: extractedData.base_price_per_sft ?? null,
      landed_price_per_sft: extractedData.landed_price_per_sft ?? null,
      construction_stage: extractedData.construction_stage ?? null,
      handover_date: extractedData.handover_date ?? null,
      schemes: Array.isArray(extractedData.schemes) ? extractedData.schemes : [],
      social_ads_summary: extractedData.social_ads_summary ?? null,
      created_at: now
    };

    const supabase = getActiveSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('project_snapshots').insert([snapshotRecord]);
      } catch (sbSnapErr) {
        console.warn('Supabase snapshot insert failed:', sbSnapErr);
      }
    }

    // Update local cache
    try {
      const cached = await getLatestSnapshots();
      const updated = [snapshotRecord, ...cached.filter(s => s.project_id !== projectId)];
      localStorage.setItem(CACHE_SNAPSHOTS_KEY, JSON.stringify(updated));
    } catch (_) {}

    return { success: true, extractedData };
  } catch (clientErr: any) {
    console.error('Client-side scraping error:', clientErr);
    return { success: false, error: clientErr.message || 'Scraping failed.' };
  }
}
