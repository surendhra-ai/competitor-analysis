import { useState, useEffect } from 'react';
import { Save, Key, Database, BrainCircuit } from 'lucide-react';

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  
  const [llmProvider, setLlmProvider] = useState('gemini');
  const [llmModel, setLlmModel] = useState('gemini-3.1-pro-preview');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [reraSites, setReraSites] = useState('https://rera.telangana.gov.in/');

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.firecrawlApiKey) setApiKey(data.firecrawlApiKey);
        if (data.supabaseUrl) setSupabaseUrl(data.supabaseUrl);
        if (data.supabaseKey) setSupabaseKey(data.supabaseKey);
        if (data.llmProvider) setLlmProvider(data.llmProvider);
        if (data.llmModel) setLlmModel(data.llmModel);
        if (data.geminiApiKey) setGeminiApiKey(data.geminiApiKey);
        if (data.openaiApiKey) setOpenaiApiKey(data.openaiApiKey);
        if (data.reraSites) setReraSites(data.reraSites);
      });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          firecrawlApiKey: apiKey,
          supabaseUrl,
          supabaseKey,
          llmProvider,
          llmModel,
          geminiApiKey,
          openaiApiKey,
          reraSites
        })
      });
      setMessage('Settings saved successfully.');
    } catch (error) {
      setMessage('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Settings</h1>
        <p className="text-zinc-500">Configure external integrations.</p>
        <div className="mt-4 p-4 bg-blue-50 text-blue-800 text-sm rounded-lg border border-blue-200">
          <strong>Note on Security:</strong> To keep your API keys secure, all settings on this page are stored locally in a secure SQLite database on the server, <strong>not</strong> in your public Supabase database.
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-zinc-100">
            <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Supabase Configuration</h2>
              <p className="text-sm text-zinc-500">Connect to your PostgreSQL database.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-2">
                Project URL
              </label>
              <input 
                type="url" 
                required
                className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-sm"
                value={supabaseUrl}
                onChange={e => setSupabaseUrl(e.target.value)}
                placeholder="https://xxxx.supabase.co"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-2">
                Anon Key
              </label>
              <input 
                type="password" 
                required
                className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-sm"
                value={supabaseKey}
                onChange={e => setSupabaseKey(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-zinc-100">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <BrainCircuit className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">LLM Configuration</h2>
              <p className="text-sm text-zinc-500">Select the AI model used for data extraction.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-2">
                  Provider
                </label>
                <select 
                  className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm"
                  value={llmProvider}
                  onChange={e => {
                    setLlmProvider(e.target.value);
                    setLlmModel(e.target.value === 'gemini' ? 'gemini-3.1-pro-preview' : 'gpt-4o');
                  }}
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-2">
                  Model
                </label>
                <select 
                  className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm"
                  value={llmModel}
                  onChange={e => setLlmModel(e.target.value)}
                >
                  {llmProvider === 'gemini' ? (
                    <>
                      <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview</option>
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    </>
                  ) : (
                    <>
                      <option value="gpt-4o">GPT-4o</option>
                      <option value="gpt-4o-mini">GPT-4o Mini</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            {llmProvider === 'gemini' && (
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-2">
                  Gemini API Key
                </label>
                <input 
                  type="password" 
                  className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-sm"
                  value={geminiApiKey}
                  onChange={e => setGeminiApiKey(e.target.value)}
                  placeholder="Leave empty to use AI Studio Secrets (GEMINI_API_KEY)"
                />
                <p className="mt-2 text-xs text-zinc-500">
                  If left empty, the system will use the default GEMINI_API_KEY from your AI Studio Secrets panel.
                </p>
              </div>
            )}

            {llmProvider === 'openai' && (
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-2">
                  OpenAI API Key
                </label>
                <input 
                  type="password" 
                  required
                  className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-sm"
                  value={openaiApiKey}
                  onChange={e => setOpenaiApiKey(e.target.value)}
                  placeholder="sk-..."
                />
              </div>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-zinc-100">
            <div className="p-2 bg-orange-100 text-orange-600 rounded-lg">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Firecrawl API</h2>
              <p className="text-sm text-zinc-500">Required for scraping competitor websites.</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-2">
              API Key
            </label>
            <input 
              type="password" 
              className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono text-sm"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="fc-..."
            />
            <p className="mt-2 text-xs text-zinc-500">
              Get your API key from <a href="https://firecrawl.dev" target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">firecrawl.dev</a>
            </p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200 space-y-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Search Grounding Configuration</h2>
              <p className="text-sm text-zinc-500">Configure official sources for AI to search.</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-2">
              Official RERA Sites (Comma-separated)
            </label>
            <textarea 
              className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm"
              value={reraSites}
              onChange={e => setReraSites(e.target.value)}
              placeholder="https://rera.telangana.gov.in/, https://maharera.mahaonline.gov.in/"
              rows={3}
            />
            <p className="mt-2 text-xs text-zinc-500">
              The AI will prioritize these official RERA sites when searching for missing project details like prices, units, and handover dates.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 pt-2">
          <button 
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 disabled:opacity-50 text-sm font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {message && (
            <span className="text-sm text-emerald-600 font-medium">{message}</span>
          )}
        </div>
      </form>
    </div>
  );
}
