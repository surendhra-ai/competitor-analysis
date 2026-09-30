import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import { GoogleGenAI, Type } from '@google/genai';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ override: true });

// We keep SQLite ONLY for local settings (API keys)
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
  INSERT OR IGNORE INTO settings (key, value) VALUES ('supabaseUrl', 'https://supabase.trusync.cloud');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('supabaseKey', 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc2MTE1NjAwMCwiZXhwIjo0OTE2ODI5NjAwLCJyb2xlIjoiYW5vbiJ9.-QMXM4M6Jpr2IYdpqd2QcUioKRz4b3N90c1Rxk_RUIM');
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
        })
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
      }
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
      }
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

function getEffectiveSupabaseCredentials() {
  const urlRow = db.prepare("SELECT value FROM settings WHERE key = 'supabaseUrl'").get() as any;
  const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'supabaseKey'").get() as any;

  const envUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const envKey = (process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  let url = (urlRow?.value || '').trim();
  let key = (keyRow?.value || '').trim();
  let source = 'database';

  // If DB setting is empty or default demo cloud, and environment variables exist (e.g. in Coolify)
  if (envUrl && (!url || url === 'https://supabase.trusync.cloud')) {
    url = envUrl;
    key = envKey || key;
    source = 'environment';
  } else if (!url && envUrl) {
    url = envUrl;
    key = envKey || key;
    source = 'environment';
  } else if (!url) {
    url = 'https://supabase.trusync.cloud';
    key = key || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc2MTE1NjAwMCwiZXhwIjo0OTE2ODI5NjAwLCJyb2xlIjoiYW5vbiJ9.-QMXM4M6Jpr2IYdpqd2QcUioKRz4b3N90c1Rxk_RUIM';
    source = 'default';
  }

  return { url, key, source };
}

function getSupabase() {
  const { url, key } = getEffectiveSupabaseCredentials();
  if (!url || !key) {
    throw new Error("Supabase credentials not configured. Please set Project URL and Anon Key in Settings or environment variables.");
  }
  return createClient(url, key);
}

function parseJsonSafely(text: string) {
  if (!text) throw new Error("Empty response from LLM");
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1].trim());
      } catch (_) {}
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch (_) {}
    }
    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
      } catch (_) {}
    }
    throw new Error(`Failed to parse LLM JSON output: ${trimmed.slice(0, 300)}...`);
  }
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
  const PORT = 3000;

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
      if (!url || !key) {
        return res.json({
          configured: false,
          connected: false,
          source,
          url: '',
          tables: { projects: false, project_snapshots: false, weekly_deltas: false },
          error: "Supabase credentials are not configured. Please set Project URL and Anon Key in Settings or Coolify environment variables.",
          schemaSql: SUPABASE_SQL_SCHEMA
        });
      }

      const supabase = createClient(url, key);
      const results = {
        configured: true,
        connected: false,
        source,
        url,
        tables: {
          projects: false,
          project_snapshots: false,
          weekly_deltas: false
        },
        projectCount: 0,
        error: null as string | null,
        schemaSql: SUPABASE_SQL_SCHEMA
      };

      // 1. Check projects table
      const projCheck = await supabase.from('projects').select('id', { count: 'exact' }).limit(1);
      if (projCheck.error) {
        results.connected = false;
        if (projCheck.error.code === '42P01') {
          results.error = "Connected to Supabase, but the 'projects' table does not exist. Please run the SQL schema script in your Supabase SQL Editor.";
        } else if (projCheck.error.message?.includes('JWT') || projCheck.error.message?.includes('apikey')) {
          results.error = "Authentication failed: Supabase Anon/API Key is invalid or expired.";
        } else {
          results.error = `Supabase query error: ${projCheck.error.message} (code: ${projCheck.error.code || 'unknown'})`;
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
    } catch (err: any) {
      console.error('Error in /api/supabase/status:', err);
      res.json({
        configured: true,
        connected: false,
        error: err.message || 'Failed to connect to Supabase.',
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
          error: testRes.error.message
        });
      }

      res.json({
        success: true,
        connected: true,
        tablesExist: true,
        count: testRes.count ?? 0,
        message: `Connected successfully! 'projects' table found with ${testRes.count ?? 0} project(s).`
      });
    } catch (err: any) {
      res.json({ success: false, connected: false, error: err.message || 'Connection test failed.' });
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
      const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
      if (error) {
        console.error('Supabase get /api/projects error:', error);
        return res.status(500).json({ error: error.message, code: error.code });
      }
      res.json(data || []);
    } catch (error: any) {
      console.error('Projects GET failure:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/projects', async (req, res) => {
    try {
      const supabase = getSupabase();
      const { name, location, official_url, rera_registration_number } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Project name is required.' });
      }
      const { data, error } = await supabase.from('projects').insert([{ 
        name: name.trim(),
        location: location?.trim() || null,
        official_url: official_url?.trim() || null,
        rera_registration_number: rera_registration_number?.trim() || null
      }]).select().single();
      if (error) {
        console.error('Supabase post /api/projects error:', error);
        return res.status(500).json({ error: error.message, code: error.code });
      }
      res.json(data);
    } catch (error: any) {
      console.error('Projects POST failure:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/projects/:id', async (req, res) => {
    try {
      const supabase = getSupabase();
      const { id } = req.params;
      const { name, location, official_url, rera_registration_number } = req.body;
      const { data, error } = await supabase.from('projects')
        .update({
          name: name?.trim(),
          location: location?.trim() || null,
          official_url: official_url?.trim() || null,
          rera_registration_number: rera_registration_number?.trim() || null
        })
        .eq('id', id)
        .select().single();
      if (error) {
        console.error('Supabase put /api/projects error:', error);
        return res.status(500).json({ error: error.message, code: error.code });
      }
      res.json(data);
    } catch (error: any) {
      console.error('Projects PUT failure:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/projects/:id', async (req, res) => {
    try {
      const supabase = getSupabase();
      const { id } = req.params;
      const { error } = await supabase.from('projects').delete().eq('id', id);
      if (error) {
        console.error('Supabase delete /api/projects error:', error);
        return res.status(500).json({ error: error.message, code: error.code });
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
      const { data, error } = await supabase
        .from('project_snapshots')
        .select('*')
        .order('scraped_at', { ascending: false });
        
      if (error) throw error;

      const latestSnapshots: any[] = [];
      const seen = new Set();
      for (const row of (data || [])) {
        if (!seen.has(row.project_id)) {
          seen.add(row.project_id);
          latestSnapshots.push(row);
        }
      }
      res.json(latestSnapshots);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/snapshots/history', async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('project_snapshots')
        .select('*')
        .order('scraped_at', { ascending: true });
        
      if (error) throw error;
      res.json(data || []);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/deltas', async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('weekly_deltas')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      res.json(data || []);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Scraping Engine ---
  app.post('/api/scrape', async (req, res) => {
    const { projectId } = req.body;
    
    try {
      const supabase = getSupabase();
      
      const { data: project, error: projError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();
        
      if (projError || !project) {
        console.error('Project not found in Supabase:', projError);
        return res.status(404).json({ error: 'Project not found in Supabase' });
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
      const { data: previousSnapshot, error: prevSnapError } = await supabase
        .from('project_snapshots')
        .select('*')
        .eq('project_id', project.id)
        .order('scraped_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prevSnapError) {
        console.error('Error fetching previous snapshot:', prevSnapError);
      }

      // 4. Save new snapshot
      const { error: snapError } = await supabase.from('project_snapshots').insert([{
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
      
      if (snapError) {
        console.error('Error inserting new snapshot:', snapError);
        throw snapError;
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
          return res.status(400).json({ error: error.message });
        }
        
        if (changes.length > 0) {
          const deltaInserts = changes.map((c: any) => ({
            project_id: project.id,
            change_type: c.change_type,
            description: c.description
          }));
          await supabase.from('weekly_deltas').insert(deltaInserts);
        }
      }

      res.json({ success: true });

    } catch (error: any) {
      console.error('Error in /api/scrape:', error);
      res.status(500).json({ error: error.message });
    }
  });


  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
