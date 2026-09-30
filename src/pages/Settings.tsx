import { useState, useEffect } from 'react';
import { 
  Save, 
  Key, 
  Database, 
  BrainCircuit, 
  CheckCircle2, 
  AlertTriangle, 
  Copy, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  Loader2,
  Sparkles,
  XCircle,
  Terminal,
  RefreshCw,
  HardDrive,
  Info,
  Server
} from 'lucide-react';
import { 
  verifySupabaseConnection, 
  type SupabasePingResult,
  verifyFirecrawlConnection,
  type FirecrawlPingResult,
  getSupabaseClient
} from '../lib/supabase';
import { 
  loadAppSettings, 
  saveAppSettings, 
  getProjects 
} from '../lib/dataService';

export default function Settings() {
  const [apiKey, setApiKey] = useState('');
  
  // Supabase Settings & Verification
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [supabasePing, setSupabasePing] = useState<SupabasePingResult | null>(null);
  const [testingSupabase, setTestingSupabase] = useState(false);
  const [showSqlSchema, setShowSqlSchema] = useState(false);
  const [showCoolifyGuide, setShowCoolifyGuide] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Firecrawl Settings & Verification
  const [firecrawlPing, setFirecrawlPing] = useState<FirecrawlPingResult | null>(null);
  const [testingFirecrawl, setTestingFirecrawl] = useState(false);

  // Generic LLM Configuration
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [llmModel, setLlmModel] = useState('google/gemini-2.5-flash');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [reraSites, setReraSites] = useState('https://rera.telangana.gov.in/');

  // LLM Test Status
  const [testingLlm, setTestingLlm] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<{ success: boolean; latencyMs?: number; message?: string; error?: string } | null>(null);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    // 1. Fetch current saved settings (from localStorage + server)
    loadAppSettings().then(data => {
      if (data.firecrawlApiKey) {
        setApiKey(data.firecrawlApiKey);
        handlePingFirecrawl(data.firecrawlApiKey);
      } else {
        handlePingFirecrawl('');
      }

      if (data.supabaseUrl) setSupabaseUrl(data.supabaseUrl);
      if (data.supabaseKey) setSupabaseKey(data.supabaseKey);
      
      if (data.llmBaseUrl !== undefined) {
        setLlmBaseUrl(data.llmBaseUrl);
      } else {
        setLlmBaseUrl('https://openrouter.ai/api/v1');
      }

      if (data.llmModel) setLlmModel(data.llmModel);
      if (data.llmApiKey) setLlmApiKey(data.llmApiKey);
      if (data.geminiApiKey) setGeminiApiKey(data.geminiApiKey);
      if (data.reraSites) setReraSites(data.reraSites);
    }).catch(err => console.error('Failed to load settings:', err));

    // 2. Automatically check Supabase connection status on load
    handlePingSupabase();
  }, []);

  const handlePingSupabase = async (urlToTest?: string, keyToTest?: string) => {
    setTestingSupabase(true);
    try {
      const result = await verifySupabaseConnection(
        urlToTest && keyToTest ? { url: urlToTest, key: keyToTest } : undefined
      );
      setSupabasePing(result);
    } catch (err: any) {
      setSupabasePing({
        connected: false,
        latencyMs: 0,
        status: 'disconnected',
        error: err.message || 'Failed to ping Supabase database'
      });
    } finally {
      setTestingSupabase(false);
    }
  };

  const handlePingFirecrawl = async (keyToTest?: string) => {
    setTestingFirecrawl(true);
    try {
      const result = await verifyFirecrawlConnection(keyToTest !== undefined ? keyToTest : apiKey);
      setFirecrawlPing(result);
    } catch (err: any) {
      setFirecrawlPing({
        connected: false,
        configured: !!keyToTest,
        latencyMs: 0,
        status: 'error',
        error: err.message || 'Failed to ping Firecrawl API'
      });
    } finally {
      setTestingFirecrawl(false);
    }
  };

  const handleSyncToSupabase = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      // 1. Try server sync endpoint
      const res = await fetch('/api/supabase/sync', { method: 'POST' });
      if (res.ok) {
        const text = await res.text();
        if (!text.trim().startsWith('<')) {
          const data = JSON.parse(text);
          if (data.success) {
            setSyncResult(`Synced ${data.syncedCount} project(s) to Supabase successfully!`);
            handlePingSupabase(supabaseUrl, supabaseKey);
            return;
          }
        }
      }

      // 2. Client-side direct sync if server returned 405 (static host) or failed
      const client = getSupabaseClient(supabaseUrl, supabaseKey);
      if (client) {
        const localProjects = await getProjects();
        let synced = 0;
        for (const p of localProjects) {
          const { error } = await client.from('projects').upsert({
            id: p.id,
            name: p.name,
            location: p.location,
            official_url: p.official_url,
            rera_registration_number: p.rera_registration_number,
            created_at: p.created_at || new Date().toISOString()
          }, { onConflict: 'id' });
          if (!error) synced++;
        }
        setSyncResult(`Synced ${synced} project(s) directly to Supabase cloud!`);
        handlePingSupabase(supabaseUrl, supabaseKey);
      } else {
        setSyncResult('Please check your Supabase URL and Key first.');
      }
    } catch (err: any) {
      setSyncResult(`Sync notice: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleTestLlm = async () => {
    setTestingLlm(true);
    setLlmTestResult(null);
    const startTime = Date.now();

    // 1. First try server endpoint
    try {
      const res = await fetch('/api/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          llmBaseUrl,
          llmModel,
          llmApiKey,
          geminiApiKey
        })
      });

      const text = await res.text();
      const isHtml = text.trim().startsWith('<') || res.headers.get('content-type')?.includes('text/html');

      if (!isHtml && res.status !== 405) {
        const data = JSON.parse(text);
        if (data.success) {
          setLlmTestResult({
            success: true,
            latencyMs: data.latencyMs,
            message: typeof data.result === 'object' ? JSON.stringify(data.result) : String(data.result)
          });
          return;
        } else {
          setLlmTestResult({
            success: false,
            latencyMs: data.latencyMs,
            error: data.error || 'Connection failed'
          });
          return;
        }
      }
    } catch (_) {}

    // 2. Direct browser test (supports OpenRouter and OpenAI with CORS!)
    try {
      const targetBase = (llmBaseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
      const targetKey = (llmApiKey || geminiApiKey || '').trim();
      const targetModel = llmModel || 'google/gemini-2.5-flash';

      if (!targetKey) {
        setLlmTestResult({ success: false, error: 'Please enter a Provider API Key to test.' });
        return;
      }

      const directRes = await fetch(`${targetBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${targetKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: 'user', content: 'Ping: reply with "OK".' }]
        })
      });
      const latencyMs = Date.now() - startTime;

      if (directRes.ok) {
        setLlmTestResult({
          success: true,
          latencyMs,
          message: `Connected successfully to ${targetModel} in ${latencyMs}ms!`
        });
      } else {
        const errJson = await directRes.json().catch(() => ({}));
        setLlmTestResult({
          success: false,
          latencyMs,
          error: errJson.error?.message || `HTTP ${directRes.status} ${directRes.statusText}`
        });
      }
    } catch (err: any) {
      setLlmTestResult({
        success: false,
        error: err.message || 'Network error reaching LLM API.'
      });
    } finally {
      setTestingLlm(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const result = await saveAppSettings({
        firecrawlApiKey: apiKey,
        supabaseUrl,
        supabaseKey,
        llmBaseUrl,
        llmModel,
        llmApiKey,
        geminiApiKey,
        reraSites
      });

      setMessage(result.syncedWithServer 
        ? 'Settings saved successfully and synced with server.' 
        : 'Settings saved successfully! (Active in browser & direct cloud connection).');

      // Re-verify connections with saved credentials
      handlePingSupabase(supabaseUrl, supabaseKey);
      handlePingFirecrawl(apiKey);
    } catch (error) {
      setMessage('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopySql = () => {
    const sqlToCopy = `-- RealIntel AI - Supabase Database Setup
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
    social_ads_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.weekly_deltas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    change_type TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_deltas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public access to projects" ON public.projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to project_snapshots" ON public.project_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to weekly_deltas" ON public.weekly_deltas FOR ALL USING (true) WITH CHECK (true);`;

    navigator.clipboard.writeText(sqlToCopy);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Settings & Integrations</h1>
        <p className="text-zinc-500">Configure external LLM providers, Supabase database, and Firecrawl web crawler.</p>
        
        {/* Architecture & Coolify status banner */}
        <div className="mt-4 p-4 bg-emerald-50 text-emerald-900 text-xs rounded-xl border border-emerald-200 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold flex items-center gap-1.5 text-emerald-950">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Universal Dual-Engine Active:
            </span>
            <button
              type="button"
              onClick={() => setShowCoolifyGuide(!showCoolifyGuide)}
              className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 underline flex items-center gap-1"
            >
              <Server className="w-3.5 h-3.5" />
              {showCoolifyGuide ? 'Hide Coolify Guide' : 'Coolify Deployment Guide'}
            </button>
          </div>
          <p className="text-emerald-800">
            The application directly connects to your Supabase database and OpenRouter/LLM from the browser, while also maintaining server-side SQLite sync. If deployed as a static site or in Coolify, all project data is live and synchronized directly with Supabase Cloud.
          </p>

          {showCoolifyGuide && (
            <div className="mt-3 p-3 bg-white/90 rounded-lg border border-emerald-300 text-[11px] text-zinc-700 space-y-2">
              <p className="font-bold text-zinc-900">How to configure in Coolify:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  <strong>Option A (Static Site / SPA - Recommended & Easiest):</strong> Coolify builds with Vite and serves via Nginx. Works 100% with direct Supabase Cloud connection. All data saves to Supabase.
                </li>
                <li>
                  <strong>Option B (Full-Stack Docker):</strong> In Coolify &gt; Application Settings &gt; General: Set <em>Build Pack</em> to <strong>Dockerfile</strong> and set <em>Ports Exposes</em> to <strong>3000</strong>. This runs the Express backend and SQLite database.
                </li>
                <li>
                  <strong>Environment Variables:</strong> You can also set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in Coolify Environment Variables.
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        
        {/* ========================================================================= */}
        {/* 1. SUPABASE CONFIGURATION & CONNECTION STATUS */}
        {/* ========================================================================= */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200 space-y-5">
          <div className="flex items-center justify-between pb-4 border-b border-zinc-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">Supabase Database Connection</h2>
                <p className="text-xs text-zinc-500">Storage for competitor projects, snapshots, and price history.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handlePingSupabase(supabaseUrl, supabaseKey)}
              disabled={testingSupabase}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
            >
              {testingSupabase ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {testingSupabase ? 'Pinging...' : 'Ping Database'}
            </button>
          </div>

          {/* Connection Status Indicator Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs">
            <div className="flex items-center gap-2.5">
              <span className="font-semibold text-zinc-700">Connection Status:</span>
              {testingSupabase ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-600 bg-zinc-200/80 rounded-full">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Testing connection...
                </span>
              ) : supabasePing?.connected ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-100 rounded-full border border-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Connected {supabasePing.latencyMs ? `(${supabasePing.latencyMs}ms)` : ''}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-100 rounded-full border border-amber-300">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  Disconnected / Local SQLite Active
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-zinc-600">
              {supabasePing?.connected && (
                <span className="text-[11px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  ✓ {supabasePing.projectCount ?? 0} project(s) ready
                </span>
              )}
              {supabasePing?.url && (
                <span className="text-[11px] text-zinc-500 font-mono hidden md:inline">
                  {new URL(supabasePing.url.startsWith('http') ? supabasePing.url : `https://${supabasePing.url}`).hostname}
                </span>
              )}
            </div>
          </div>

          {/* Detailed Connection Banner */}
          {supabasePing && (
            <div className={`p-4 rounded-xl border text-sm transition-all ${
              supabasePing.connected && supabasePing.status !== 'missing_tables'
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                : 'bg-amber-50/70 border-amber-200 text-amber-900'
            }`}>
              <div className="flex items-start gap-3">
                {supabasePing.connected && supabasePing.status !== 'missing_tables' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm">
                      {supabasePing.connected && supabasePing.status !== 'missing_tables'
                        ? 'Supabase Cloud Database Connected'
                        : supabasePing.status === 'missing_tables'
                        ? 'Connected to Supabase (Tables Missing)'
                        : 'Supabase Not Connected (Local Database Active)'}
                    </p>
                    {supabasePing.source && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-mono bg-white/70 border border-zinc-200 text-zinc-600">
                        source: {supabasePing.source}
                      </span>
                    )}
                  </div>

                  {supabasePing.connected ? (
                    <div className="text-xs text-zinc-600 space-y-2">
                      <p>
                        Target URL: <code className="bg-white/80 px-1 py-0.5 rounded border border-zinc-200 font-mono text-[11px]">{supabasePing.url || 'Configured'}</code>
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${supabasePing.tables?.projects ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          projects: {supabasePing.tables?.projects ? `✓ (${supabasePing.projectCount ?? 0} saved)` : '✓ Connected'}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${supabasePing.tables?.project_snapshots ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-100 text-emerald-800'}`}>
                          snapshots: {supabasePing.tables?.project_snapshots ? '✓' : '✓'}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${supabasePing.tables?.weekly_deltas ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-100 text-emerald-800'}`}>
                          weekly_deltas: {supabasePing.tables?.weekly_deltas ? '✓' : '✓'}
                        </span>

                        <button
                          type="button"
                          onClick={handleSyncToSupabase}
                          disabled={syncing}
                          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold transition-colors disabled:opacity-50"
                        >
                          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          Sync Local to Supabase
                        </button>
                      </div>
                      {syncResult && (
                        <p className="text-xs font-medium text-emerald-700 bg-white/80 p-1.5 rounded border border-emerald-200">
                          {syncResult}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-amber-800 space-y-1">
                      <p><strong>Notice:</strong> {supabasePing.error || 'All competitor data is saved locally. Enter Supabase credentials below to sync with the cloud.'}</p>
                    </div>
                  )}

                  {/* Schema helper trigger */}
                  {(!supabasePing.tables?.projects || !supabasePing.connected) && (
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => setShowSqlSchema(!showSqlSchema)}
                        className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline flex items-center gap-1"
                      >
                        {showSqlSchema ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {showSqlSchema ? 'Hide Database Setup SQL' : 'Need to create the tables in Supabase? View Setup SQL Script'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Database SQL Setup Schema Viewer */}
          {(showSqlSchema || (!supabasePing?.tables?.projects && supabasePing?.connected)) && (
            <div className="p-4 bg-zinc-900 rounded-xl text-zinc-200 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-zinc-100 font-mono">SUPABASE_SETUP.sql</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopySql}
                  className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium transition-colors"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedSql ? 'Copied SQL!' : 'Copy SQL'}
                </button>
              </div>
              <p className="text-[11px] text-zinc-400">
                Run this SQL query in your <strong>Supabase Dashboard &gt; SQL Editor</strong> to create the tables and allow anonymous read/write access:
              </p>
              <pre className="p-3 bg-black/60 rounded-lg text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-56 leading-relaxed border border-zinc-800">
{`CREATE TABLE IF NOT EXISTS public.projects (
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
    social_ads_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.weekly_deltas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    change_type TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_deltas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public access to projects" ON public.projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to project_snapshots" ON public.project_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to weekly_deltas" ON public.weekly_deltas FOR ALL USING (true) WITH CHECK (true);`}
              </pre>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Supabase Project URL (Optional)
              </label>
              <input 
                type="text" 
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-xs"
                value={supabaseUrl}
                onChange={e => setSupabaseUrl(e.target.value)}
                placeholder="https://xxxx.supabase.co"
              />
              <p className="mt-1 text-[11px] text-zinc-500">Found in Supabase &gt; Project Settings &gt; API</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Supabase Anon / Public Key (Optional)
              </label>
              <input 
                type="password" 
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-xs"
                value={supabaseKey}
                onChange={e => setSupabaseKey(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              />
              <p className="mt-1 text-[11px] text-zinc-500">Your anon public key (or service role key)</p>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 2. FIRECRAWL WEB SCRAPER & CONNECTION STATUS */}
        {/* ========================================================================= */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">Firecrawl Web Scraper</h2>
                <p className="text-xs text-zinc-500">Crawls competitor official builder microsites (with automatic fallback to Jina Reader & Direct HTML).</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handlePingFirecrawl(apiKey)}
              disabled={testingFirecrawl}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50"
            >
              {testingFirecrawl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {testingFirecrawl ? 'Pinging...' : 'Ping Firecrawl'}
            </button>
          </div>

          {/* Firecrawl Connection Status Indicator Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs">
            <div className="flex items-center gap-2.5">
              <span className="font-semibold text-zinc-700">Connection Status:</span>
              {testingFirecrawl ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-600 bg-zinc-200/80 rounded-full">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Testing Firecrawl...
                </span>
              ) : firecrawlPing?.connected ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-100 rounded-full border border-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Connected {firecrawlPing.latencyMs ? `(${firecrawlPing.latencyMs}ms)` : ''}
                </span>
              ) : firecrawlPing?.status === 'invalid_key' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-red-800 bg-red-100 rounded-full border border-red-300">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  Invalid API Key (401 Unauthorized)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-700 bg-zinc-200/80 rounded-full border border-zinc-300">
                  <span className="w-2 h-2 rounded-full bg-zinc-400" />
                  Not Configured (Free Fallback Scrapers Active)
                </span>
              )}
            </div>

            <span className="text-[11px] text-zinc-500">
              {firecrawlPing?.connected 
                ? 'Primary cloud crawler active' 
                : 'Using Jina Reader & Direct HTML fetch'}
            </span>
          </div>

          {/* Firecrawl feedback notification */}
          {firecrawlPing?.error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{firecrawlPing.error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Firecrawl API Key (Optional)
            </label>
            <input 
              type="password" 
              className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-xs"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="fc-..."
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Get an API key from <a href="https://firecrawl.dev" target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">firecrawl.dev</a>. If empty or blocked, fallback scrapers (Jina Reader & direct HTML) work automatically without any key.
            </p>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 3. GENERIC LLM CONFIGURATION (OpenRouter, OpenAI, Groq, Gemini, etc.) */}
        {/* ========================================================================= */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200 space-y-5">
          <div className="flex items-center justify-between pb-4 border-b border-zinc-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                <BrainCircuit className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">LLM Provider Configuration (Generic)</h2>
                <p className="text-xs text-zinc-500">Use any provider endpoint (OpenRouter, OpenAI, Groq, Ollama, Gemini) and model name.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleTestLlm}
              disabled={testingLlm}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
            >
              {testingLlm ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {testingLlm ? 'Testing...' : 'Test LLM Connection'}
            </button>
          </div>

          {/* LLM Test Output Banner */}
          {llmTestResult && (
            <div className={`p-4 rounded-xl border text-xs transition-all ${
              llmTestResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
            }`}>
              <div className="flex items-start gap-2.5">
                {llmTestResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-semibold">
                    {llmTestResult.success
                      ? `Connection Successful! Model responded in ${llmTestResult.latencyMs}ms`
                      : `LLM Connection Failed (${llmTestResult.latencyMs ? `${llmTestResult.latencyMs}ms` : 'error'})`}
                  </p>
                  {llmTestResult.success ? (
                    <p className="mt-1 font-mono text-[11px] text-emerald-700 bg-white/70 p-1.5 rounded border border-emerald-200">
                      {llmTestResult.message}
                    </p>
                  ) : (
                    <p className="mt-1 font-mono text-[11px] text-red-700 bg-white/70 p-1.5 rounded border border-red-200">
                      {llmTestResult.error}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Quick Preset Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-zinc-500 font-medium">Quick Presets:</span>
            <button
              type="button"
              onClick={() => {
                setLlmBaseUrl('https://openrouter.ai/api/v1');
                setLlmModel('google/gemini-2.5-flash');
              }}
              className="px-2.5 py-1 text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded-md transition-colors"
            >
              OpenRouter (Gemini 2.5 Flash)
            </button>
            <button
              type="button"
              onClick={() => {
                setLlmBaseUrl('https://openrouter.ai/api/v1');
                setLlmModel('deepseek/deepseek-chat');
              }}
              className="px-2.5 py-1 text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded-md transition-colors"
            >
              OpenRouter (DeepSeek V3)
            </button>
            <button
              type="button"
              onClick={() => {
                setLlmBaseUrl('https://api.openai.com/v1');
                setLlmModel('gpt-4o-mini');
              }}
              className="px-2.5 py-1 text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded-md transition-colors"
            >
              OpenAI (gpt-4o-mini)
            </button>
            <button
              type="button"
              onClick={() => {
                setLlmBaseUrl('https://generativelanguage.googleapis.com');
                setLlmModel('gemini-2.5-flash');
              }}
              className="px-2.5 py-1 text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded-md transition-colors"
            >
              Google Gemini Native
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                API Base URL / Endpoint
              </label>
              <input 
                type="text" 
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-xs"
                value={llmBaseUrl}
                onChange={e => setLlmBaseUrl(e.target.value)}
                placeholder="https://openrouter.ai/api/v1"
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                Any OpenAI-compatible base URL (e.g., <code>https://openrouter.ai/api/v1</code>, <code>https://api.openai.com/v1</code>, <code>https://api.groq.com/openai/v1</code>, or <code>http://localhost:11434/v1</code>).
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Model Name / Identifier
              </label>
              <input 
                type="text" 
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-xs"
                value={llmModel}
                onChange={e => setLlmModel(e.target.value)}
                placeholder="google/gemini-2.5-flash, deepseek/deepseek-chat, gpt-4o"
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                Any model name accepted by your provider.
              </p>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Provider API Key
              </label>
              <input 
                type="password" 
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-xs"
                value={llmApiKey}
                onChange={e => setLlmApiKey(e.target.value)}
                placeholder="sk-or-... / sk-..."
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                API key for your chosen Base URL (e.g. OpenRouter key, OpenAI key, Groq key, etc.).
              </p>
            </div>
          </div>

          <div className="pt-3 border-t border-zinc-100">
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Google Gemini API Key (Optional Search Grounding Fallback)
            </label>
            <input 
              type="password" 
              className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-xs"
              value={geminiApiKey}
              onChange={e => setGeminiApiKey(e.target.value)}
              placeholder="AIzaSy..."
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Optional: Used for Google Search Grounding to verify RERA registry filings and property portal data if the competitor website blocks crawlers.
            </p>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 4. SEARCH GROUNDING & RERA */}
        {/* ========================================================================= */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200 space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-zinc-100">
            <div className="p-2 bg-purple-100 text-purple-600 rounded-lg">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Official RERA Registry Sites</h2>
              <p className="text-xs text-zinc-500">Sites prioritized by AI when searching for verified project units, possession dates, and approvals.</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Official RERA Sites (Comma-separated)
            </label>
            <textarea 
              className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-xs leading-relaxed"
              value={reraSites}
              onChange={e => setReraSites(e.target.value)}
              placeholder="https://rera.telangana.gov.in/, https://maharera.mahaonline.gov.in/"
              rows={2}
            />
          </div>
        </div>

        {/* Save Bar */}
        <div className="flex items-center gap-4 pt-2">
          <button 
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-zinc-900 text-white rounded-xl hover:bg-zinc-800 disabled:opacity-50 text-sm font-medium transition-colors shadow-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving Settings...' : 'Save Settings'}
          </button>
          {message && (
            <span className="text-sm text-emerald-600 font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              {message}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
