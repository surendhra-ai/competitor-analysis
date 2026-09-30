import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import { GoogleGenAI, Type } from '@google/genai';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ override: true });

// Local SQLite database for persistent storage (works out-of-the-box in Coolify, Docker, or local)
const db = new Database('realintel.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
  );
  CREATE TABLE IF NOT EXISTS weekly_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT,
      data TEXT
  );
  CREATE TABLE IF NOT EXISTS local_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT,
      official_url TEXT,
      rera_registration_number TEXT,
      created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS local_project_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      scraped_at TEXT DEFAULT (datetime('now')),
      no_of_units INTEGER,
      no_of_floors INTEGER,
      land_area_acres REAL,
      base_price_per_sft REAL,
      landed_price_per_sft REAL,
      construction_stage TEXT,
      handover_date TEXT,
      schemes TEXT,
      social_ads_summary TEXT,
      created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS local_weekly_deltas (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      change_type TEXT,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Auto-migrate legacy or high-tier Gemini models that exceed the free quota
try {
  const currentModelRow = db.prepare("SELECT value FROM settings WHERE key = 'llmModel'").get() as any;
  if (currentModelRow) {
    const modelVal = currentModelRow.value;
    if (modelVal === 'gemini-3.1-pro-preview' || modelVal === 'gemini-3.5-flash' || modelVal === 'gemini-3-flash-preview' || modelVal === 'gemini-2.5-pro') {
      console.log(`Migrating database model setting from '${modelVal}' to 'gemini-2.5-flash' to prevent quota issues.`);
      db.prepare("UPDATE settings SET value = 'gemini-2.5-flash' WHERE key = 'llmModel'").run();
    }
  }
} catch (e) {
  console.error('Failed to run settings model migration:', e);
}

async function scrapeUrlWithFallback(url: string, firecrawlApiKey: string): Promise<string> {
  // 1. Try Firecrawl if key is provided
  if (firecrawlApiKey) {
    try {
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${firecrawlApiKey}`
        },
        body: JSON.stringify({
          url: url,
          formats: ['markdown']
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        const data = await response.json();
        const markdown = data.data?.markdown || '';
        if (markdown.trim()) {
          console.log(`Successfully scraped ${url} using Firecrawl API.`);
          return markdown;
        }
      } else {
        console.warn(`Firecrawl API for ${url} returned ${response.status} ${response.statusText}. Trying fallback scrapers...`);
      }
    } catch (err: any) {
      console.warn(`Firecrawl request for ${url} failed: ${err.message || err}. Trying fallback scrapers...`);
    }
  }

  // 2. Fallback 1: Jina Reader API
  try {
    console.log(`Attempting Jina Reader fallback for ${url}...`);
    const jinaRes = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/plain'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (jinaRes.ok) {
      const text = await jinaRes.text();
      if (text.trim() && !text.includes('403 Forbidden') && !text.includes('Access Denied')) {
        console.log(`Successfully scraped ${url} via Jina Reader fallback (${text.length} chars).`);
        return text;
      }
    }
  } catch (jinaErr: any) {
    console.warn(`Jina Reader fallback failed for ${url}:`, jinaErr.message || jinaErr);
  }

  // 3. Fallback 2: Direct HTML Fetch & text extraction
  try {
    console.log(`Attempting direct HTML fetch for ${url}...`);
    const directRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (directRes.ok) {
      const html = await directRes.text();
      const cleanText = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanText.length > 100) {
        console.log(`Successfully extracted ${cleanText.length} chars from ${url} via direct HTML fetch.`);
        return cleanText.slice(0, 15000);
      }
    }
  } catch (directErr: any) {
    console.warn(`Direct fetch fallback failed for ${url}:`, directErr.message || directErr);
  }

  return '';
}

export const SUPABASE_SQL_SCHEMA = `-- RealIntel AI - Supabase Database Setup
-- Paste and run this script in your Supabase SQL Editor:
-- Supabase Dashboard > SQL Editor > New query > Run

CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    location TEXT,
    official_url TEXT,
    rera_registration_number TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    scraped_at TIMESTAMPTZ DEFAULT now(),
    no_of_units INTEGER,
    no_of_floors INTEGER,
    land_area_acres NUMERIC,
    base_price_per_sft NUMERIC,
    landed_price_per_sft NUMERIC,
    construction_stage TEXT,
    handover_date TEXT,
    schemes JSONB DEFAULT '[]'::jsonb,
    social_ads_summary TEXT
);

CREATE TABLE IF NOT EXISTS public.weekly_deltas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    change_type TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security (RLS) with full public access policies for Anon Key
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_deltas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public access to projects" ON public.projects;
CREATE POLICY "Public access to projects" ON public.projects FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access to project_snapshots" ON public.project_snapshots;
CREATE POLICY "Public access to project_snapshots" ON public.project_snapshots FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access to weekly_deltas" ON public.weekly_deltas;
CREATE POLICY "Public access to weekly_deltas" ON public.weekly_deltas FOR ALL USING (true) WITH CHECK (true);`;

function formatSupabaseErrorMessage(err: any): string {
  const msg = err?.message || String(err || '');
  if (msg.includes("Unexpected token '<'") || msg.includes("<!doctype") || msg.includes("is not valid JSON") || msg.includes("SyntaxError")) {
    return "The Supabase URL returned an HTML webpage instead of the Supabase API (Received: <!doctype html...). Please check your Supabase URL: it should be your Supabase REST API endpoint (e.g. https://<project-ref>.supabase.co or your self-hosted Kong endpoint http://host:8000), NOT your frontend dashboard, app URL, or web browser URL.";
  }
  if (msg.includes("fetch failed") || msg.includes("ENOTFOUND") || msg.includes("ECONNREFUSED") || msg.includes("ERR_NAME_NOT_RESOLVED")) {
    return `Could not reach the host at ${err?.hostname || 'the specified Supabase URL'}. Please verify your domain, network, and firewall settings.`;
  }
  if (msg.includes("JWT") || msg.includes("apikey") || msg.includes("401") || msg.includes("403")) {
    return "Supabase API authentication failed. Verify that your Supabase Anon Key (or Service Role Key) is accurate.";
  }
  return msg;
}

function getEffectiveSupabaseCredentials() {
  const urlRow = db.prepare("SELECT value FROM settings WHERE key = 'supabaseUrl'").get() as any;
  const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'supabaseKey'").get() as any;

  const envUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const envKey = (process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  let url = (urlRow?.value || '').trim();
  let key = (keyRow?.value || '').trim();
  let source = 'database';

  // If DB setting is empty, check environment variables (Coolify)
  if (!url && envUrl) {
    url = envUrl;
    key = envKey || key;
    source = 'environment';
  }

  return { url, key, source: url ? source : 'none' };
}

function getSupabase() {
  const { url, key } = getEffectiveSupabaseCredentials();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key);
}

function parseJsonSafely(text: string) {
  if (!text) throw new Error("Empty response from LLM");
  let cleaned = text.trim();

  // Strip <think>...</think> blocks from reasoning models (e.g. DeepSeek-R1)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // If text starts with conversational thinking prelude, look for code blocks
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  const matches = [...cleaned.matchAll(codeBlockRegex)];
  if (matches.length > 0) {
    // Try code blocks from last to first (reasoning models typically put final output in last block)
    for (let i = matches.length - 1; i >= 0; i--) {
      const blockContent = matches[i][1].trim();
      try {
        return JSON.parse(blockContent);
      } catch (_) {
        try {
          const withoutTrailingCommas = blockContent.replace(/,\s*([}\]])/g, '$1');
          return JSON.parse(withoutTrailingCommas);
        } catch (_) {}
      }
    }
  }

  // Direct parse attempt
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  // Attempt removing trailing commas
  try {
    const withoutTrailingCommas = cleaned.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(withoutTrailingCommas);
  } catch (_) {}

  // Extract from first { to last }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) {
      try {
        const withoutTrailingCommas = candidate.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(withoutTrailingCommas);
      } catch (_) {}
    }
  }

  // Extract from first [ to last ]
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = cleaned.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) {
      try {
        const withoutTrailingCommas = candidate.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(withoutTrailingCommas);
      } catch (_) {}
    }
  }

  throw new Error(`Failed to parse LLM JSON output: ${cleaned.slice(0, 300)}...`);
}

async function callLLM(promptText: string, schema: any, customConfig?: { baseUrl?: string; model?: string; apiKey?: string }) {
  const settingsRows = db.prepare("SELECT * FROM settings").all() as any[];
  const settingsMap = settingsRows.reduce((acc: any, curr: any) => {
    acc[curr.key] = curr.value;
    return acc;
  }, {});

  const baseUrl = (customConfig?.baseUrl ?? (settingsMap.llmBaseUrl || process.env.LLM_BASE_URL || '')).trim();
  const model = (customConfig?.model ?? (settingsMap.llmModel || process.env.LLM_MODEL || 'google/gemini-2.5-flash')).trim();
  let apiKey = (customConfig?.apiKey ?? (settingsMap.llmApiKey || settingsMap.openaiApiKey || process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '')).trim();
  
  let geminiApiKey = (settingsMap.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
  if (geminiApiKey === 'MY_GEMINI_API_KEY') geminiApiKey = '';

  // Determine if this is Google Gemini Native
  const isGeminiNative = baseUrl.includes('generativelanguage.googleapis.com') ||
    (!baseUrl && (geminiApiKey || apiKey.startsWith('AIzaSy')));

  if (isGeminiNative) {
    const keyToUse = apiKey || geminiApiKey;
    if (!keyToUse) {
      throw new Error('Gemini API Key is not set. Please enter your API Key in Settings or environment variables.');
    }
    const ai = new GoogleGenAI({ apiKey: keyToUse });
    const cleanModel = model.replace(/^google\//, '') || 'gemini-2.5-flash';
    try {
      const aiResponse = await ai.models.generateContent({
        model: cleanModel,
        contents: promptText,
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema
        }
      });
      return parseJsonSafely(aiResponse.text || '{}');
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      if (errorMsg.includes('API key not valid') || errorMsg.includes('API_KEY_INVALID')) {
        throw new Error('Invalid Gemini API Key. Please check your settings.');
      }
      if ((errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('Quota')) && cleanModel !== 'gemini-2.5-flash') {
        console.warn(`Gemini model '${cleanModel}' failed with quota/compatibility error. Falling back to gemini-2.5-flash...`);
        const fallbackResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: promptText,
          config: {
            responseMimeType: 'application/json',
            responseSchema: schema
          }
        });
        return parseJsonSafely(fallbackResponse.text || '{}');
      }
      throw error;
    }
  }

  // Generic OpenAI-compatible endpoint (OpenRouter, OpenAI, Groq, Together, Ollama, DeepSeek, etc.)
  const effectiveBaseUrl = baseUrl || 'https://openrouter.ai/api/v1';
  if (!apiKey) {
    throw new Error(`API Key is not configured for LLM endpoint '${effectiveBaseUrl}'. Please enter your API key in Settings.`);
  }

  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: effectiveBaseUrl,
    defaultHeaders: {
      'HTTP-Referer': 'https://realintel.local',
      'X-Title': 'RealIntel Competitor Intelligence'
    }
  });

  const schemaString = JSON.stringify(schema, null, 2)
    .replace(/"OBJECT"/g, '"object"')
    .replace(/"STRING"/g, '"string"')
    .replace(/"INTEGER"/g, '"integer"')
    .replace(/"NUMBER"/g, '"number"')
    .replace(/"ARRAY"/g, '"array"');

  const fullPrompt = `${promptText}\n\nCRITICAL: Return ONLY a valid JSON object or array strictly matching this schema. No markdown wrapping, no code fences, no explanations:\n${schemaString}`;

  try {
    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: 'You are an expert real estate data extraction system that strictly returns valid JSON.' },
        { role: 'user', content: fullPrompt }
      ],
      response_format: { type: 'json_object' }
    });
    const content = completion.choices[0]?.message?.content || '{}';
    return parseJsonSafely(content);
  } catch (err: any) {
    // If provider or model does not support response_format { type: 'json_object' }
    if (err?.message?.includes('response_format') || err?.message?.includes('json_object') || err?.status === 400) {
      console.warn(`Provider rejected response_format: json_object for model '${model}'. Retrying with prompt-guided JSON...`);
      const fallbackCompletion = await openai.chat.completions.create({
        model: model,
        messages: [
          { role: 'system', content: 'You are an expert real estate data extraction system that strictly returns valid JSON.' },
          { role: 'user', content: fullPrompt }
        ]
      });
      const fbContent = fallbackCompletion.choices[0]?.message?.content || '{}';
      return parseJsonSafely(fbContent);
    }
    throw err;
  }
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Enable CORS for external access / microservices
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json());

  app.get('/api/env-check', (req, res) => {
    res.json({
      gemini: !!process.env.GEMINI_API_KEY,
      geminiVal: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 5) : null,
      api: !!process.env.API_KEY
    });
  });

  // --- Supabase Diagnostics & Connection Check ---
  app.get('/api/supabase/status', async (req, res) => {
    try {
      const { url, key, source } = getEffectiveSupabaseCredentials();
      const localCountRow = db.prepare("SELECT COUNT(*) as count FROM local_projects").get() as any;
      const localProjectCount = localCountRow?.count ?? 0;

      if (!url || !key) {
        return res.json({
          configured: false,
          connected: false,
          source: 'none',
          url: '',
          localProjectCount,
          tables: { projects: false, project_snapshots: false, weekly_deltas: false },
          projectCount: localProjectCount,
          error: 'No Supabase credentials configured. The app is currently using the local SQLite database. All projects, snapshots, and deltas are stored locally.',
          schemaSql: SUPABASE_SQL_SCHEMA
        });
      }

      const results = {
        configured: true,
        connected: false,
        source,
        url,
        localProjectCount,
        tables: {
          projects: false,
          project_snapshots: false,
          weekly_deltas: false
        },
        projectCount: localProjectCount,
        error: null as string | null,
        schemaSql: SUPABASE_SQL_SCHEMA
      };

      try {
        const supabase = createClient(url, key);
        // 1. Check projects table
        const projCheck = await supabase.from('projects').select('id', { count: 'exact' }).limit(1);
        if (projCheck.error) {
          results.connected = false;
          if (projCheck.error.code === '42P01') {
            results.error = "Connected to Supabase, but the 'projects' table does not exist. Please run the SQL schema script in your Supabase SQL Editor.";
          } else if (projCheck.error.message?.includes('JWT') || projCheck.error.message?.includes('apikey')) {
            results.error = "Authentication failed: Supabase Anon/API Key is invalid or expired.";
          } else {
            results.error = formatSupabaseErrorMessage(projCheck.error);
          }
          return res.json(results);
        }

        results.connected = true;
        results.tables.projects = true;
        results.projectCount = projCheck.count ?? 0;

        // 2. Check snapshots table
        const snapCheck = await supabase.from('project_snapshots').select('id').limit(1);
        results.tables.project_snapshots = !snapCheck.error;

        // 3. Check deltas table
        const deltaCheck = await supabase.from('weekly_deltas').select('id').limit(1);
        results.tables.weekly_deltas = !deltaCheck.error;

        res.json(results);
      } catch (clientErr: any) {
        results.connected = false;
        results.error = formatSupabaseErrorMessage(clientErr);
        res.json(results);
      }
    } catch (err: any) {
      console.error('Error in /api/supabase/status:', err);
      res.json({
        configured: false,
        connected: false,
        error: formatSupabaseErrorMessage(err),
        schemaSql: SUPABASE_SQL_SCHEMA
      });
    }
  });

  app.post('/api/supabase/test', async (req, res) => {
    try {
      const { supabaseUrl, supabaseKey } = req.body;
      if (!supabaseUrl || !supabaseKey) {
        return res.status(400).json({ success: false, error: 'Both Supabase URL and Anon Key are required for testing.' });
      }

      try {
        const client = createClient(supabaseUrl.trim(), supabaseKey.trim());
        const testRes = await client.from('projects').select('id', { count: 'exact' }).limit(1);

        if (testRes.error) {
          if (testRes.error.code === '42P01') {
            return res.json({
              success: true,
              connected: true,
              tablesExist: false,
              message: "Connected to Supabase successfully, but the 'projects' table does not exist yet. Please run the SQL schema in your Supabase SQL Editor."
            });
          }
          return res.json({
            success: false,
            connected: false,
            error: formatSupabaseErrorMessage(testRes.error)
          });
        }

        res.json({
          success: true,
          connected: true,
          tablesExist: true,
          count: testRes.count ?? 0,
          message: `Connected successfully! 'projects' table found with ${testRes.count ?? 0} project(s).`
        });
      } catch (clientErr: any) {
        res.json({
          success: false,
          connected: false,
          error: formatSupabaseErrorMessage(clientErr)
        });
      }
    } catch (err: any) {
      res.json({ success: false, connected: false, error: formatSupabaseErrorMessage(err) });
    }
  });

  // --- Supabase Sync (Local <-> Supabase) ---
  app.post('/api/supabase/sync', async (req, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        return res.status(400).json({ error: 'Supabase is not configured yet. Please enter credentials in Settings.' });
      }

      const localProjects = db.prepare("SELECT * FROM local_projects").all() as any[];
      let syncedCount = 0;
      for (const p of localProjects) {
        const { error } = await supabase.from('projects').upsert({
          id: p.id,
          name: p.name,
          location: p.location,
          official_url: p.official_url,
          rera_registration_number: p.rera_registration_number,
          created_at: p.created_at
        }, { onConflict: 'id' });
        if (!error) syncedCount++;
      }

      // Also pull projects from Supabase to local
      const { data: remoteProjects, error: fetchErr } = await supabase.from('projects').select('*');
      if (!fetchErr && remoteProjects) {
        const insertStmt = db.prepare(`
          INSERT INTO local_projects (id, name, location, official_url, rera_registration_number, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            location=excluded.location,
            official_url=excluded.official_url,
            rera_registration_number=excluded.rera_registration_number
        `);
        for (const rp of remoteProjects) {
          insertStmt.run(rp.id, rp.name, rp.location, rp.official_url, rp.rera_registration_number, rp.created_at);
        }
      }

      res.json({ success: true, syncedCount, totalProjects: remoteProjects?.length || localProjects.length });
    } catch (err: any) {
      res.status(500).json({ error: formatSupabaseErrorMessage(err) });
    }
  });

  // --- Firecrawl Connection Test & Status ---
  app.post('/api/firecrawl/test', async (req, res) => {
    let key = (req.body?.apiKey || '').trim();
    if (!key) {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'firecrawlApiKey'").get() as any;
      key = (row?.value || process.env.FIRECRAWL_API_KEY || '').trim();
    }

    if (!key) {
      return res.json({
        success: false,
        connected: false,
        status: 'unconfigured',
        error: 'No Firecrawl API key configured.'
      });
    }

    const startTime = Date.now();
    try {
      // 1. Try lightweight credit-usage endpoint
      const creditRes = await fetch('https://api.firecrawl.dev/v1/team/credit-usage', {
        headers: { 'Authorization': `Bearer ${key}` }
      });

      const latencyMs = Date.now() - startTime;
      if (creditRes.ok) {
        const usageData = await creditRes.json().catch(() => ({}));
        return res.json({
          success: true,
          connected: true,
          status: 'connected',
          latencyMs,
          message: 'Firecrawl API is connected and active.',
          data: usageData?.data || usageData
        });
      }

      if (creditRes.status === 401 || creditRes.status === 403) {
        return res.json({
          success: false,
          connected: false,
          status: 'invalid_key',
          latencyMs,
          error: 'Authentication failed: Invalid Firecrawl API key (401 Unauthorized).'
        });
      }

      // 2. Fallback: lightweight test scrape
      const pingRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({ url: 'https://example.com' })
      });
      const pingLatency = Date.now() - startTime;

      if (pingRes.ok) {
        return res.json({
          success: true,
          connected: true,
          status: 'connected',
          latencyMs: pingLatency,
          message: 'Firecrawl API connected and verified.'
        });
      } else if (pingRes.status === 401 || pingRes.status === 403) {
        return res.json({
          success: false,
          connected: false,
          status: 'invalid_key',
          latencyMs: pingLatency,
          error: 'Authentication failed: Invalid Firecrawl API key (401 Unauthorized).'
        });
      } else {
        const errJson = await pingRes.json().catch(() => ({}));
        return res.json({
          success: false,
          connected: false,
          status: 'error',
          latencyMs: pingLatency,
          error: errJson.error || `Firecrawl API returned HTTP ${pingRes.status}`
        });
      }
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      return res.json({
        success: false,
        connected: false,
        status: 'error',
        latencyMs,
        error: err.message || 'Network error reaching Firecrawl API.'
      });
    }
  });

  app.get('/api/firecrawl/status', async (req, res) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'firecrawlApiKey'").get() as any;
    const key = (row?.value || process.env.FIRECRAWL_API_KEY || '').trim();
    if (!key) {
      return res.json({
        configured: false,
        connected: false,
        status: 'unconfigured',
        message: 'No Firecrawl API key configured. Built-in fallback scrapers (Jina Reader & Direct Fetch) are active.'
      });
    }

    const startTime = Date.now();
    try {
      const creditRes = await fetch('https://api.firecrawl.dev/v1/team/credit-usage', {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      const latencyMs = Date.now() - startTime;
      if (creditRes.ok) {
        const usageData = await creditRes.json().catch(() => ({}));
        return res.json({
          configured: true,
          connected: true,
          status: 'connected',
          latencyMs,
          message: 'Firecrawl API is connected and ready.',
          data: usageData?.data || usageData
        });
      } else if (creditRes.status === 401 || creditRes.status === 403) {
        return res.json({
          configured: true,
          connected: false,
          status: 'invalid_key',
          latencyMs,
          error: 'Invalid Firecrawl API key (401 Unauthorized).'
        });
      } else {
        return res.json({
          configured: true,
          connected: false,
          status: 'error',
          latencyMs,
          error: `Firecrawl returned status ${creditRes.status}.`
        });
      }
    } catch (err: any) {
      return res.json({
        configured: true,
        connected: false,
        status: 'error',
        error: err.message || 'Failed to ping Firecrawl API.'
      });
    }
  });

  // --- LLM Test Connection ---
  app.post('/api/llm/test', async (req, res) => {
    const { llmBaseUrl, llmModel, llmApiKey, geminiApiKey } = req.body;
    const startTime = Date.now();
    try {
      const testSchema = {
        type: Type.OBJECT,
        properties: {
          status: { type: Type.STRING },
          message: { type: Type.STRING },
          provider: { type: Type.STRING }
        },
        required: ["status", "message"]
      };

      const result = await callLLM(
        "Ping test: Respond with status 'ok' and a brief friendly confirmation message.",
        testSchema,
        { baseUrl: llmBaseUrl, model: llmModel, apiKey: llmApiKey || geminiApiKey }
      );

      const latencyMs = Date.now() - startTime;
      res.json({
        success: true,
        latencyMs,
        model: llmModel,
        result
      });
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      res.json({
        success: false,
        latencyMs,
        error: error.message || 'LLM connection test failed'
      });
    }
  });

  // --- Settings ---
  app.get('/api/settings', (req, res) => {
    const settings = db.prepare('SELECT * FROM settings').all() as any[];
    const settingsMap: Record<string, any> = settings.reduce((acc: Record<string, any>, curr: any) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});

    const { url, key, source } = getEffectiveSupabaseCredentials();
    settingsMap.effectiveSupabaseUrl = url;
    settingsMap.supabaseSource = source;
    settingsMap.supabaseEnvSet = !!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);

    res.json(settingsMap);
  });

  app.post('/api/settings', (req, res) => {
    const {
      firecrawlApiKey,
      supabaseUrl,
      supabaseKey,
      llmBaseUrl,
      llmModel,
      llmApiKey,
      geminiApiKey,
      openaiApiKey,
      reraSites,
      llmProvider
    } = req.body;

    const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    if (firecrawlApiKey !== undefined) stmt.run('firecrawlApiKey', firecrawlApiKey);
    if (supabaseUrl !== undefined) stmt.run('supabaseUrl', supabaseUrl);
    if (supabaseKey !== undefined) stmt.run('supabaseKey', supabaseKey);
    if (llmBaseUrl !== undefined) stmt.run('llmBaseUrl', llmBaseUrl);
    if (llmModel !== undefined) stmt.run('llmModel', llmModel);
    if (llmApiKey !== undefined) stmt.run('llmApiKey', llmApiKey);
    if (geminiApiKey !== undefined) stmt.run('geminiApiKey', geminiApiKey);
    if (openaiApiKey !== undefined) stmt.run('openaiApiKey', openaiApiKey);
    if (reraSites !== undefined) stmt.run('reraSites', reraSites);
    if (llmProvider !== undefined) stmt.run('llmProvider', llmProvider);
    res.json({ success: true });
  });

  // --- Weekly Updates ---
  app.get('/api/weekly_updates', (req, res) => {
    try {
      const updates = db.prepare('SELECT * FROM weekly_updates ORDER BY timestamp DESC').all();
      res.json(updates.map((u: any) => ({ ...u, data: JSON.parse(u.data) })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/weekly_updates', (req, res) => {
    try {
      const { data } = req.body;
      const timestamp = new Date().toISOString();
      const stmt = db.prepare('INSERT INTO weekly_updates (timestamp, data) VALUES (?, ?)');
      stmt.run(timestamp, JSON.stringify(data));
      res.json({ success: true, timestamp });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/weekly_updates/:id', (req, res) => {
    try {
      const stmt = db.prepare('DELETE FROM weekly_updates WHERE id = ?');
      stmt.run(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Projects ---
  app.get('/api/projects', async (req, res) => {
    try {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
          if (!error && Array.isArray(data)) {
            // Background sync into local SQLite
            const upsertStmt = db.prepare(`
              INSERT INTO local_projects (id, name, location, official_url, rera_registration_number, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                location=excluded.location,
                official_url=excluded.official_url,
                rera_registration_number=excluded.rera_registration_number
            `);
            for (const p of data) {
              upsertStmt.run(p.id, p.name, p.location, p.official_url, p.rera_registration_number, p.created_at);
            }
            return res.json(data);
          }
        } catch (supErr: any) {
          console.warn('Supabase fetch failed, falling back to local SQLite:', formatSupabaseErrorMessage(supErr));
        }
      }

      // Fallback to local SQLite database (always returns 200 OK!)
      const localList = db.prepare("SELECT * FROM local_projects ORDER BY created_at DESC").all();
      res.json(localList);
    } catch (error: any) {
      console.error('Projects GET failure:', error.message);
      res.json([]); // Return empty list instead of 500 so UI never crashes
    }
  });

  app.post('/api/projects', async (req, res) => {
    try {
      const { name, location, official_url, rera_registration_number } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Project name is required.' });
      }

      const id = crypto.randomUUID();
      const trimmedName = name.trim();
      const loc = location?.trim() || null;
      const url = official_url?.trim() || null;
      const rera = rera_registration_number?.trim() || null;
      const now = new Date().toISOString();

      // 1. Always save into local SQLite database first!
      const stmt = db.prepare(`
        INSERT INTO local_projects (id, name, location, official_url, rera_registration_number, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, trimmedName, loc, url, rera, now);

      const savedProject = {
        id,
        name: trimmedName,
        location: loc,
        official_url: url,
        rera_registration_number: rera,
        created_at: now
      };

      // 2. Also save to Supabase if configured
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase.from('projects').insert([{
            id,
            name: trimmedName,
            location: loc,
            official_url: url,
            rera_registration_number: rera
          }]).select().single();
          if (!error && data) {
            return res.json(data);
          }
          if (error) {
            console.warn('Supabase project insert failed, saved to local SQLite:', formatSupabaseErrorMessage(error));
          }
        } catch (supErr: any) {
          console.warn('Supabase project insert exception, saved to local SQLite:', formatSupabaseErrorMessage(supErr));
        }
      }

      res.json(savedProject);
    } catch (error: any) {
      console.error('Projects POST failure:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/projects/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { name, location, official_url, rera_registration_number } = req.body;
      const trimmedName = name?.trim();
      const loc = location?.trim() || null;
      const url = official_url?.trim() || null;
      const rera = rera_registration_number?.trim() || null;

      // Update local SQLite
      db.prepare(`
        UPDATE local_projects
        SET name = coalesce(?, name),
            location = coalesce(?, location),
            official_url = coalesce(?, official_url),
            rera_registration_number = coalesce(?, rera_registration_number)
        WHERE id = ?
      `).run(trimmedName, loc, url, rera, id);

      const updated = db.prepare("SELECT * FROM local_projects WHERE id = ?").get(id);

      // Also update Supabase if configured
      const supabase = getSupabase();
      if (supabase) {
        try {
          await supabase.from('projects')
            .update({
              name: trimmedName,
              location: loc,
              official_url: url,
              rera_registration_number: rera
            })
            .eq('id', id);
        } catch (supErr: any) {
          console.warn('Supabase update failed:', formatSupabaseErrorMessage(supErr));
        }
      }

      res.json(updated);
    } catch (error: any) {
      console.error('Projects PUT failure:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/projects/:id', async (req, res) => {
    try {
      const { id } = req.params;
      // Delete locally
      db.prepare("DELETE FROM local_projects WHERE id = ?").run(id);
      db.prepare("DELETE FROM local_project_snapshots WHERE project_id = ?").run(id);
      db.prepare("DELETE FROM local_weekly_deltas WHERE project_id = ?").run(id);

      // Also delete from Supabase if configured
      const supabase = getSupabase();
      if (supabase) {
        try {
          await supabase.from('projects').delete().eq('id', id);
        } catch (supErr: any) {
          console.warn('Supabase delete failed:', formatSupabaseErrorMessage(supErr));
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error('Projects DELETE failure:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Snapshots & Deltas ---
  app.get('/api/snapshots/latest', async (req, res) => {
    try {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase
            .from('project_snapshots')
            .select('*')
            .order('scraped_at', { ascending: false });
          if (!error && Array.isArray(data)) {
            const latestSnapshots: any[] = [];
            const seen = new Set();
            for (const row of data) {
              if (!seen.has(row.project_id)) {
                seen.add(row.project_id);
                latestSnapshots.push(row);
              }
            }
            return res.json(latestSnapshots);
          }
        } catch (supErr) {
          console.warn('Supabase snapshots/latest failed, using local SQLite:', supErr);
        }
      }

      // Local fallback
      const localRows = db.prepare("SELECT * FROM local_project_snapshots ORDER BY scraped_at DESC").all() as any[];
      const latestSnapshots: any[] = [];
      const seen = new Set();
      for (const row of localRows) {
        if (!seen.has(row.project_id)) {
          seen.add(row.project_id);
          latestSnapshots.push({
            ...row,
            schemes: typeof row.schemes === 'string' ? JSON.parse(row.schemes || '[]') : (row.schemes || [])
          });
        }
      }
      res.json(latestSnapshots);
    } catch (error: any) {
      res.json([]);
    }
  });

  app.get('/api/snapshots/history', async (req, res) => {
    try {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase
            .from('project_snapshots')
            .select('*')
            .order('scraped_at', { ascending: true });
          if (!error && Array.isArray(data)) {
            return res.json(data);
          }
        } catch (supErr) {
          console.warn('Supabase snapshots/history failed, using local SQLite:', supErr);
        }
      }

      const localRows = db.prepare("SELECT * FROM local_project_snapshots ORDER BY scraped_at ASC").all() as any[];
      res.json(localRows.map((r: any) => ({
        ...r,
        schemes: typeof r.schemes === 'string' ? JSON.parse(r.schemes || '[]') : (r.schemes || [])
      })));
    } catch (error: any) {
      res.json([]);
    }
  });

  app.get('/api/deltas', async (req, res) => {
    try {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase
            .from('weekly_deltas')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
          if (!error && Array.isArray(data)) {
            return res.json(data);
          }
        } catch (supErr) {
          console.warn('Supabase deltas failed, using local SQLite:', supErr);
        }
      }

      const localDeltas = db.prepare("SELECT * FROM local_weekly_deltas ORDER BY created_at DESC LIMIT 50").all();
      res.json(localDeltas);
    } catch (error: any) {
      res.json([]);
    }
  });

  // --- Scraping Engine ---
  app.post('/api/scrape', async (req, res) => {
    const { projectId } = req.body;
    
    try {
      // 1. Fetch project from local SQLite or Supabase
      let project = db.prepare("SELECT * FROM local_projects WHERE id = ?").get(projectId) as any;
      const supabase = getSupabase();
      if (!project && supabase) {
        try {
          const { data } = await supabase.from('projects').select('*').eq('id', projectId).single();
          if (data) project = data;
        } catch (_) {}
      }

      if (!project) {
        return res.status(404).json({ error: 'Project not found in local or remote database.' });
      }

      const settingsRows = db.prepare("SELECT * FROM settings").all() as any[];
      const settingsMap = settingsRows.reduce((acc: any, curr: any) => {
        acc[curr.key] = curr.value;
        return acc;
      }, {});

      const firecrawlApiKey = (settingsMap.firecrawlApiKey || '').trim();
      let geminiApiKey = (settingsMap.geminiApiKey || '').trim();
      if (geminiApiKey && !geminiApiKey.startsWith('AIzaSy')) {
        geminiApiKey = '';
      }
      if (!geminiApiKey) {
        geminiApiKey = (process.env.GEMINI_API_KEY || '').trim();
      }
      if (geminiApiKey === 'MY_GEMINI_API_KEY') {
        geminiApiKey = '';
      }

      const reraSites = settingsMap.reraSites || 'https://rera.telangana.gov.in/';

      // 1. Scrape using Firecrawl with automatic fallbacks (Jina Reader / Direct Fetch)
      let scrapedText = '';
      const urlsToScrape = (project.official_url || '').split(',').map((u: string) => u.trim()).filter((u: string) => u);

      for (const url of urlsToScrape) {
        try {
          const content = await scrapeUrlWithFallback(url, firecrawlApiKey);
          if (content) {
            scrapedText += `\n\n--- Scraped from ${url} ---\n\n` + content;
          }
        } catch (error: any) {
          console.warn(`Scraping attempt failed for ${url}:`, error.message || error);
        }
      }

      if (!scrapedText.trim()) {
        console.warn('Direct website scraping returned no text; proceeding with Gemini Search Grounding.');
      }

      // 1.5 Search Grounding with Gemini
      let searchSummary = '';
      try {
        if (geminiApiKey) {
          const searchAi = new GoogleGenAI({ apiKey: geminiApiKey });
          const searchPrompt = `
            You are an expert real estate data researcher. Your task is to find comprehensive and up-to-date details for the project "${project.name}" located in "${project.location || 'Telangana, India'}".
            ${project.rera_registration_number ? `The RERA Registration Number is ${project.rera_registration_number}.` : ''}
            
            Please use the Google Search tool to find the most accurate information from:
            1. Official RERA websites, specifically prioritizing these sites: ${reraSites}. If a RERA number is provided, you MUST search for that exact number on the RERA site to find the official project details.
            2. The official project microsite (${project.official_url})
            3. Major property portals (MagicBricks, Housing.com, 99acres, SquareYards, PropTiger).
            4. Official social media pages (Facebook, Instagram, YouTube), broker videos, or recent news articles for the project.

            You MUST find and extract the following specific data points:
            - Total Number of Units/Apartments
            - Number of Floors and Towers
            - Total Land Area in Acres
            - Base Price per Sq.Ft (₹/sft)
            - Landed Price per Sq.Ft (₹/sft) or total package price
            - Current Construction Stage
            - Expected Handover/Possession Date (Month and Year)
            - Any active schemes, offers, or pre-launch benefits
            - Marketing focus or social media summary

            CRITICAL INSTRUCTION: Do NOT guess or hallucinate numbers. If you cannot find a specific value, explicitly state "Not found".
          `;
          const searchResponse = await searchAi.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: searchPrompt,
            config: {
              tools: [{ googleSearch: {} }]
            }
          });
          searchSummary = searchResponse.text || '';
        }
      } catch (searchError: any) {
        console.error('Search grounding failed, continuing without it:', searchError?.message || String(searchError));
      }

      // 2. Process with configured generic LLM (OpenRouter / OpenAI / Gemini / etc.)
      const prompt = `
        You are an expert real estate data extraction system.
        Analyze the following scraped text from a real estate project website AND the supplemental web search summary.
        Project Name: ${project.name}
        
        Extract the following information. You MUST merge the data from both sources. If the official website text is vague or missing data, heavily rely on the Supplemental Web Search Summary (which contains RERA info, portal data, and social media updates).
        
        CRITICAL: DO NOT GUESS OR HALLUCINATE VALUES. If a specific data point is not explicitly mentioned in either the scraped text or the search summary, you MUST return null for that field. Do not assume a default price like 8500 unless it is explicitly stated for this specific project.

        - Number of Units (integer, null if not found)
        - Number of Floors (integer, null if not found)
        - Land Area in Acres (number, null if not found)
        - Base Price per Sft in Rs (number, null if not found. Extract approximate numerical value only. This is the raw price before amenities/parking. e.g., if "starts at 8,500/sqft", extract 8500. If a range is given, take the lower bound. Do NOT confuse with total package price. If only a total package price is given and no per-sqft price is explicitly mentioned, you MUST return null.)
        - Landed Price per Sft in Rs (number, null if not found. Extract approximate numerical value only. This is the all-inclusive price. If only total package price is given (e.g., 1.5 Cr for 1500 sqft), calculate the landed price per sqft (15000000/1500 = 10000). If you cannot confidently calculate it because the exact area for that price is missing, you MUST return null. Do not guess or estimate.)
        - Construction Stage (short text, e.g., "Excavation", "Foundation", "Superstructure", "Finishing", null if not found)
        - Handover Date (text, e.g., "Dec 2025", null if not found. Look for "possession", "completion", "handover", or "RERA possession date". Ensure you extract the year and month if available. If multiple dates are found, prefer the RERA possession date or the latest completion date mentioned.)
        - Schemes/Offers (array of strings, empty if none)
        - Social/Ads Summary (short text summarizing any marketing campaigns, broker videos, or social proof mentioned, null if not found)

        Supplemental Web Search Summary (including RERA info, pricing, and social media updates):
        ${searchSummary}

        Scraped Text (from official website):
        ${scrapedText.substring(0, 15000)}
      `;

      const extractionSchema = {
        type: Type.OBJECT,
        properties: {
          no_of_units: { type: Type.INTEGER, nullable: true },
          no_of_floors: { type: Type.INTEGER, nullable: true },
          land_area_acres: { type: Type.NUMBER, nullable: true },
          base_price_per_sft: { type: Type.NUMBER, nullable: true },
          landed_price_per_sft: { type: Type.NUMBER, nullable: true },
          construction_stage: { type: Type.STRING, nullable: true },
          handover_date: { type: Type.STRING, nullable: true },
          schemes: { type: Type.ARRAY, items: { type: Type.STRING } },
          social_ads_summary: { type: Type.STRING, nullable: true }
        }
      };

      let extractedData;
      try {
        extractedData = await callLLM(prompt, extractionSchema);
      } catch (error: any) {
        console.error('LLM extraction failed:', error);
        return res.status(400).json({ error: error.message });
      }

      // 3. Get previous snapshot to generate deltas
      let previousSnapshot = db.prepare("SELECT * FROM local_project_snapshots WHERE project_id = ? ORDER BY scraped_at DESC LIMIT 1").get(project.id) as any;
      if (previousSnapshot && typeof previousSnapshot.schemes === 'string') {
        try { previousSnapshot.schemes = JSON.parse(previousSnapshot.schemes); } catch (_) {}
      }
      if (!previousSnapshot && supabase) {
        try {
          const { data: remoteSnap } = await supabase.from('project_snapshots').select('*').eq('project_id', project.id).order('scraped_at', { ascending: false }).limit(1).maybeSingle();
          if (remoteSnap) previousSnapshot = remoteSnap;
        } catch (_) {}
      }

      // 4. Save new snapshot to local SQLite
      const snapshotId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      db.prepare(`
        INSERT INTO local_project_snapshots (
          id, project_id, scraped_at, no_of_units, no_of_floors, land_area_acres,
          base_price_per_sft, landed_price_per_sft, construction_stage, handover_date, schemes, social_ads_summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        snapshotId,
        project.id,
        nowIso,
        extractedData.no_of_units ?? null,
        extractedData.no_of_floors ?? null,
        extractedData.land_area_acres ?? null,
        extractedData.base_price_per_sft ?? null,
        extractedData.landed_price_per_sft ?? null,
        extractedData.construction_stage ?? null,
        extractedData.handover_date ?? null,
        JSON.stringify(extractedData.schemes || []),
        extractedData.social_ads_summary ?? null,
        nowIso
      );

      // Also save to Supabase if available
      if (supabase) {
        try {
          await supabase.from('project_snapshots').insert([{
            id: snapshotId,
            project_id: project.id,
            no_of_units: extractedData.no_of_units,
            no_of_floors: extractedData.no_of_floors,
            land_area_acres: extractedData.land_area_acres,
            base_price_per_sft: extractedData.base_price_per_sft,
            landed_price_per_sft: extractedData.landed_price_per_sft,
            construction_stage: extractedData.construction_stage,
            handover_date: extractedData.handover_date,
            schemes: extractedData.schemes || [],
            social_ads_summary: extractedData.social_ads_summary
          }]);
        } catch (snapError: any) {
          console.warn('Failed to insert snapshot into Supabase, local copy saved:', snapError.message);
        }
      }

      // 5. Generate Incremental Updates (Weekly Deltas) using AI
      if (previousSnapshot) {
        const deltaPrompt = `
          Compare the previous data and current data for the real estate project "${project.name}".
          Identify any significant changes (e.g., price hikes, construction progress, new schemes).
          
          Previous Data:
          ${JSON.stringify(previousSnapshot)}
          
          Current Data:
          ${JSON.stringify(extractedData)}
          
          Return an array of changes. If there are no changes, return an empty array.
        `;

        const deltaSchema = {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              change_type: { type: Type.STRING, description: "e.g., 'Price Hike', 'Construction Progress', 'New Scheme'" },
              description: { type: Type.STRING, description: "A clear, concise sentence describing the change." }
            },
            required: ["change_type", "description"]
          }
        };

        let changes: any[] = [];
        try {
          changes = await callLLM(deltaPrompt, deltaSchema);
          if (!Array.isArray(changes)) {
            changes = [];
          }
        } catch (error: any) {
          console.warn('Delta generation failed:', error.message);
        }
        
        if (changes.length > 0) {
          const insertDelta = db.prepare(`
            INSERT INTO local_weekly_deltas (id, project_id, change_type, description, created_at)
            VALUES (?, ?, ?, ?, datetime('now'))
          `);
          for (const c of changes) {
            insertDelta.run(crypto.randomUUID(), project.id, c.change_type, c.description);
          }

          if (supabase) {
            try {
              const deltaInserts = changes.map((c: any) => ({
                project_id: project.id,
                change_type: c.change_type,
                description: c.description
              }));
              await supabase.from('weekly_deltas').insert(deltaInserts);
            } catch (supErr: any) {
              console.warn('Failed to insert deltas into Supabase, local saved:', supErr.message);
            }
          }
        }
      }

      res.json({ success: true, extractedData });

    } catch (error: any) {
      console.error('Error in /api/scrape:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Explicit catch-all for unknown /api/* routes so they NEVER return HTML
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API route ${req.method} ${req.path} not found.` });
  });

  // Vite middleware for development vs Express static for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: `API route ${req.method} ${req.path} not found.` });
      }
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
