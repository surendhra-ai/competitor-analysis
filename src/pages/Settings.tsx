import { useState, useEffect } from 'react';
import { 
  Save, 
  Key, 
  Database, 
  BrainCircuit, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Copy, 
  Check, 
  ExternalLink, 
  HelpCircle, 
  Sparkles, 
  Terminal, 
  ChevronDown, 
  ChevronUp, 
  AlertTriangle 
} from 'lucide-react';

interface SupabaseStatus {
  configured: boolean;
  connected: boolean;
  source?: string;
  url?: string;
  tables?: {
    projects: boolean;
    project_snapshots: boolean;
    weekly_deltas: boolean;
  };
  projectCount?: number;
  error?: string | null;
  schemaSql?: string;
}

export default function SettingsPage() {
  // Firecrawl
  const [apiKey, setApiKey] = useState('');
  
  // Supabase
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [supabaseStatus, setSupabaseStatus] = useState<SupabaseStatus | null>(null);
  const [testingSupabase, setTestingSupabase] = useState(false);
  const [showSqlSchema, setShowSqlSchema] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Generic LLM Configuration
  const [llmBaseUrl, setLlmBaseUrl] = useState('https://openrouter.ai/api/v1');
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
    // 1. Fetch current saved settings
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.firecrawlApiKey) setApiKey(data.firecrawlApiKey);
        if (data.supabaseUrl) setSupabaseUrl(data.supabaseUrl);
        if (data.supabaseKey) setSupabaseKey(data.supabaseKey);
        
        // Generic LLM fields
        if (data.llmBaseUrl !== undefined) {
          setLlmBaseUrl(data.llmBaseUrl);
        } else if (data.llmProvider === 'openai') {
          setLlmBaseUrl('https://api.openai.com/v1');
        } else if (data.llmProvider === 'gemini') {
          setLlmBaseUrl('https://generativelanguage.googleapis.com');
        }

        if (data.llmModel) setLlmModel(data.llmModel);
        if (data.llmApiKey) {
          setLlmApiKey(data.llmApiKey);
        } else if (data.openaiApiKey) {
          setLlmApiKey(data.openaiApiKey);
        }

        if (data.geminiApiKey) setGeminiApiKey(data.geminiApiKey);
        if (data.reraSites) setReraSites(data.reraSites);
      })
      .catch(err => console.error('Failed to load settings:', err));

    // 2. Automatically check Supabase connection status
    checkSupabaseConnection();
  }, []);

  const checkSupabaseConnection = async () => {
    setTestingSupabase(true);
    try {
      const res = await fetch('/api/supabase/status');
      const data = await res.json();
      setSupabaseStatus(data);
    } catch (err: any) {
      setSupabaseStatus({
        configured: true,
        connected: false,
        error: err.message || 'Network error checking Supabase connection.'
      });
    } finally {
      setTestingSupabase(false);
    }
  };

  const handleTestLlm = async () => {
    setTestingLlm(true);
    setLlmTestResult(null);
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
      const data = await res.json();
      if (data.success) {
        setLlmTestResult({
          success: true,
          latencyMs: data.latencyMs,
          message: typeof data.result === 'object' ? JSON.stringify(data.result) : String(data.result)
        });
      } else {
        setLlmTestResult({
          success: false,
          latencyMs: data.latencyMs,
          error: data.error || 'Connection failed'
        });
      }
    } catch (err: any) {
      setLlmTestResult({
        success: false,
        error: err.message || 'Failed to communicate with server.'
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
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          firecrawlApiKey: apiKey,
          supabaseUrl,
          supabaseKey,
          llmBaseUrl,
          llmModel,
          llmApiKey,
          geminiApiKey,
          reraSites
        })
      });
      if (res.ok) {
        setMessage('Settings saved successfully.');
        // Re-check Supabase with new credentials
        checkSupabaseConnection();
      } else {
        setMessage('Failed to save settings.');
      }
    } catch (error) {
      setMessage('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopySql = () => {
    if (supabaseStatus?.schemaSql) {
      navigator.clipboard.writeText(supabaseStatus.schemaSql);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2500);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Settings & Integrations</h1>
        <p className="text-zinc-500">Configure external LLM providers (OpenRouter, OpenAI, Gemini), Supabase database, and crawler APIs.</p>
        <div className="mt-3 p-3 bg-blue-50 text-blue-800 text-xs rounded-lg border border-blue-200">
          <strong>Security Note:</strong> All API keys and connection parameters are encrypted and stored in local server SQLite storage (not exposed publicly).
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        
        {/* ========================================================================= */}
        {/* 1. SUPABASE CONFIGURATION & CONNECTION CHECK */}
        {/* ========================================================================= */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200 space-y-5">
          <div className="flex items-center justify-between pb-4 border-b border-zinc-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">Supabase Database Connection</h2>
                <p className="text-xs text-zinc-500">Persistent storage for competitor projects, snapshots, and price history.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={checkSupabaseConnection}
              disabled={testingSupabase}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
            >
              {testingSupabase ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
              {testingSupabase ? 'Testing...' : 'Check Connection'}
            </button>
          </div>

          {/* Connection Status Banner */}
          {supabaseStatus && (
            <div className={`p-4 rounded-xl border text-sm transition-all ${
              supabaseStatus.connected && supabaseStatus.tables?.projects
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                : 'bg-amber-50/70 border-amber-200 text-amber-900'
            }`}>
              <div className="flex items-start gap-3">
                {supabaseStatus.connected && supabaseStatus.tables?.projects ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm">
                      {supabaseStatus.connected && supabaseStatus.tables?.projects
                        ? 'Connected to Supabase'
                        : supabaseStatus.connected
                        ? 'Connected to Supabase (Tables Missing)'
                        : 'Not Connected to Supabase'}
                    </p>
                    {supabaseStatus.source && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-mono bg-white/70 border border-zinc-200 text-zinc-600">
                        source: {supabaseStatus.source}
                      </span>
                    )}
                  </div>

                  {supabaseStatus.connected ? (
                    <div className="text-xs text-zinc-600 space-y-1">
                      <p>
                        Target URL: <code className="bg-white/80 px-1 py-0.5 rounded border border-zinc-200 font-mono text-[11px]">{supabaseStatus.url || 'Configured'}</code>
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${supabaseStatus.tables?.projects ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          projects: {supabaseStatus.tables?.projects ? `✓ (${supabaseStatus.projectCount ?? 0} saved)` : '✗ missing'}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${supabaseStatus.tables?.project_snapshots ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          snapshots: {supabaseStatus.tables?.project_snapshots ? '✓' : '✗ missing'}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${supabaseStatus.tables?.weekly_deltas ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          weekly_deltas: {supabaseStatus.tables?.weekly_deltas ? '✓' : '✗ missing'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-amber-800 space-y-1">
                      <p><strong>Reason:</strong> {supabaseStatus.error || 'Failed to authenticate or connect.'}</p>
                      <p className="text-[11px] text-zinc-500">
                        In Coolify: You can also set <code>SUPABASE_URL</code> and <code>SUPABASE_KEY</code> in Coolify Environment Variables.
                      </p>
                    </div>
                  )}

                  {/* Schema helper trigger */}
                  {(!supabaseStatus.tables?.projects || !supabaseStatus.connected) && (
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
          {(showSqlSchema || (!supabaseStatus?.tables?.projects && supabaseStatus?.connected)) && (
            <div className="p-4 bg-zinc-900 rounded-xl text-zinc-200 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-semibold text-white">Supabase SQL Schema Script</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopySql}
                  className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-xs transition-colors"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedSql ? 'Copied to Clipboard!' : 'Copy SQL'}
                </button>
              </div>
              <p className="text-xs text-zinc-400">
                To create the required tables and public access policies, open your <strong>Supabase Dashboard &gt; SQL Editor &gt; New Query</strong>, paste the script below, and click <strong>Run</strong>:
              </p>
              <pre className="p-3 bg-zinc-950 rounded-lg text-[11px] font-mono text-emerald-300 max-h-52 overflow-y-auto leading-relaxed border border-zinc-800">
                {supabaseStatus?.schemaSql || `-- Run this in Supabase SQL Editor:
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
                Supabase Project URL
              </label>
              <input 
                type="text" 
                required
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-xs"
                value={supabaseUrl}
                onChange={e => setSupabaseUrl(e.target.value)}
                placeholder="https://xxxx.supabase.co"
              />
              <p className="mt-1 text-[11px] text-zinc-500">Found in Supabase &gt; Project Settings &gt; API</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Supabase Anon / Public Key
              </label>
              <input 
                type="password" 
                required
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
        {/* 2. GENERIC LLM CONFIGURATION (OpenRouter, OpenAI, Groq, Gemini, etc.) */}
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

          <div className="space-y-4">
            {/* Base URL / Endpoint Field */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                API Base URL / Endpoint (Text Field)
              </label>
              <input 
                type="text" 
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-xs"
                value={llmBaseUrl}
                onChange={e => setLlmBaseUrl(e.target.value)}
                placeholder="https://openrouter.ai/api/v1 (or https://api.openai.com/v1)"
              />
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[11px] text-zinc-400 mr-1">Quick Presets:</span>
                <button
                  type="button"
                  onClick={() => {
                    setLlmBaseUrl('https://openrouter.ai/api/v1');
                    if (!llmModel.includes('/')) setLlmModel('google/gemini-2.5-flash');
                  }}
                  className="px-2 py-0.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded text-[11px] font-mono border border-zinc-200 transition-colors"
                >
                  OpenRouter
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLlmBaseUrl('https://api.openai.com/v1');
                    setLlmModel('gpt-4o-mini');
                  }}
                  className="px-2 py-0.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded text-[11px] font-mono border border-zinc-200 transition-colors"
                >
                  OpenAI
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLlmBaseUrl('https://api.groq.com/openai/v1');
                    setLlmModel('llama-3.3-70b-versatile');
                  }}
                  className="px-2 py-0.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded text-[11px] font-mono border border-zinc-200 transition-colors"
                >
                  Groq
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLlmBaseUrl('http://localhost:11434/v1');
                    setLlmModel('llama3.2');
                  }}
                  className="px-2 py-0.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded text-[11px] font-mono border border-zinc-200 transition-colors"
                >
                  Ollama (Local)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLlmBaseUrl('https://generativelanguage.googleapis.com');
                    setLlmModel('gemini-2.5-flash');
                  }}
                  className="px-2 py-0.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded text-[11px] font-mono border border-zinc-200 transition-colors"
                >
                  Google Gemini (Native)
                </button>
              </div>
            </div>

            {/* Model Name Field */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Model Name (Text Field)
              </label>
              <input 
                type="text" 
                required
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-xs"
                value={llmModel}
                onChange={e => setLlmModel(e.target.value)}
                placeholder="e.g. google/gemini-2.5-flash, anthropic/claude-3.5-sonnet, gpt-4o-mini"
              />
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[11px] text-zinc-400 mr-1">Suggestions:</span>
                {[
                  'google/gemini-2.5-flash',
                  'anthropic/claude-3.5-sonnet',
                  'meta-llama/llama-3.3-70b-instruct',
                  'openai/gpt-4o-mini',
                  'deepseek/deepseek-chat',
                  'gpt-4o'
                ].map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setLlmModel(m)}
                    className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[11px] font-mono border border-blue-200 transition-colors"
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* API Key Field */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                LLM API Key
              </label>
              <input 
                type="password" 
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-xs"
                value={llmApiKey}
                onChange={e => setLlmApiKey(e.target.value)}
                placeholder="sk-or-v1-... (OpenRouter) or sk-... (OpenAI) or AIzaSy... (Gemini)"
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                Your API key for OpenRouter, OpenAI, Groq, or whichever provider you specified above.
              </p>
            </div>

            {/* Optional Gemini Search Grounding Key */}
            <div className="pt-2 border-t border-zinc-100">
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Google Search Grounding Key (Optional)
              </label>
              <input 
                type="password" 
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-xs"
                value={geminiApiKey}
                onChange={e => setGeminiApiKey(e.target.value)}
                placeholder="Leave blank to use GEMINI_API_KEY from environment"
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                Powers real-time Google web search grounding for official RERA records and broker updates. If left empty, defaults to server environment variable.
              </p>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 3. FIRECRAWL API */}
        {/* ========================================================================= */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200 space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-zinc-100">
            <div className="p-2 bg-orange-100 text-orange-600 rounded-lg">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Firecrawl Web Scraper</h2>
              <p className="text-xs text-zinc-500">Crawls competitor official builder microsites (with automatic fallback to Jina Reader & Direct HTML).</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Firecrawl API Key
            </label>
            <input 
              type="password" 
              className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-xs"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="fc-..."
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Get an API key from <a href="https://firecrawl.dev" target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">firecrawl.dev</a>. If empty or blocked, fallback scrapers are used automatically.
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
