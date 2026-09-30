import { useState, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  Globe, 
  FileText, 
  RefreshCw, 
  Play, 
  Pencil, 
  AlertTriangle, 
  CheckCircle2, 
  ExternalLink, 
  Loader2, 
  Database 
} from 'lucide-react';
import { Link } from 'react-router';

interface Project {
  id: string;
  name: string;
  location: string;
  official_url: string;
  rera_registration_number: string;
  created_at: string;
}

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
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [isAdding, setIsAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [scrapingIds, setScrapingIds] = useState<Set<string>>(new Set());
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ current: number, total: number, projectName: string, success: number, fail: number, isComplete: boolean } | null>(null);

  const [supabaseStatus, setSupabaseStatus] = useState<SupabaseStatus | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    location: '',
    official_url: '',
    rera_registration_number: ''
  });

  useEffect(() => {
    fetchProjects();
    checkSupabaseStatus();
  }, []);

  const checkSupabaseStatus = async () => {
    try {
      const res = await fetch('/api/supabase/status');
      const data = await res.json();
      setSupabaseStatus(data);
    } catch (e) {
      console.error('Error checking Supabase status:', e);
    }
  };

  const fetchProjects = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (Array.isArray(data)) {
        setProjects(data);
      } else {
        setProjects([]);
        setFetchError(data.error || 'Failed to fetch projects from database.');
      }
    } catch (error: any) {
      console.error('Failed to fetch projects', error);
      setProjects([]);
      setFetchError(error.message || 'Failed to connect to backend.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      const url = editingId ? `/api/projects/${editingId}` : '/api/projects';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        const errorMsg = data.error || `Server responded with status ${res.status}`;
        setFormError(errorMsg);
        return; // KEEP MODAL OPEN SO USER DOES NOT LOSE TYPED INPUT
      }

      // Success
      setFormData({ name: '', location: '', official_url: '', rera_registration_number: '' });
      setIsAdding(false);
      setEditingId(null);
      await fetchProjects();
      checkSupabaseStatus();
    } catch (error: any) {
      console.error('Failed to save project', error);
      setFormError(error.message || 'Network error occurred while saving.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure? This will delete all historical data for this project.')) return;
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert('Failed to delete project: ' + (data.error || 'Server error'));
        return;
      }
      fetchProjects();
      
      // Remove from selection if deleted
      if (selectedProjects.has(id)) {
        const newSet = new Set(selectedProjects);
        newSet.delete(id);
        setSelectedProjects(newSet);
      }
    } catch (error) {
      console.error('Failed to delete project', error);
      alert('Network error while deleting project.');
    }
  };

  const handleScrape = async (id: string, showAlert = true) => {
    setScrapingIds(prev => new Set(prev).add(id));
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id })
      });
      const data = await res.json();
      if (data.error) {
        if (showAlert) alert('Scraping failed: ' + data.error);
        return false;
      } else {
        if (showAlert) alert('Scraping completed successfully!');
        return true;
      }
    } catch (error) {
      console.error('Failed to trigger scrape', error);
      if (showAlert) alert('An error occurred while scraping.');
      return false;
    } finally {
      setScrapingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  const handleBulkScrape = async () => {
    if (selectedProjects.size === 0) return;
    
    const projectArray = Array.from(selectedProjects);
    setBulkProgress({ current: 0, total: projectArray.length, projectName: '', success: 0, fail: 0, isComplete: false });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < projectArray.length; i++) {
      const id = projectArray[i];
      const project = projects.find(p => p.id === id);
      
      setBulkProgress(prev => prev ? { ...prev, current: i + 1, projectName: project?.name || 'Unknown' } : null);

      const success = await handleScrape(id, false);
      
      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      setBulkProgress(prev => prev ? { ...prev, success: successCount, fail: failCount } : null);
    }
    
    setBulkProgress(prev => prev ? { ...prev, isComplete: true, projectName: 'All projects processed' } : null);
    setSelectedProjects(new Set());
  };

  const handleEditClick = (project: Project) => {
    setFormData({
      name: project.name,
      location: project.location || '',
      official_url: project.official_url || '',
      rera_registration_number: project.rera_registration_number || ''
    });
    setEditingId(project.id);
    setIsAdding(true);
    setFormError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleProject = (id: string) => {
    const newSet = new Set(selectedProjects);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedProjects(newSet);
  };

  const toggleAll = () => {
    if (selectedProjects.size === projects.length) {
      setSelectedProjects(new Set());
    } else {
      setSelectedProjects(new Set(projects.map(p => p.id)));
    }
  };

  const isSupabaseIssue = supabaseStatus && (!supabaseStatus.connected || !supabaseStatus.tables?.projects);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      
      {/* Supabase Connection Warning Banner if disconnected */}
      {isSupabaseIssue && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-start gap-3 text-amber-900 text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <h4 className="font-semibold text-amber-950">
              {supabaseStatus?.connected
                ? "Supabase Database Connected, but 'projects' Table is Missing"
                : "Supabase Database is Disconnected"}
            </h4>
            <p className="text-xs text-amber-800 leading-relaxed">
              {supabaseStatus?.error || "The application could not reach or query your Supabase database. Added projects cannot be saved until this is resolved."}
            </p>
            <div className="pt-2 flex items-center gap-3">
              <Link 
                to="/settings" 
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-xs font-semibold transition-colors"
              >
                <Database className="w-3.5 h-3.5" />
                Configure Supabase & Setup SQL in Settings
              </Link>
              <button 
                type="button" 
                onClick={checkSupabaseStatus} 
                className="text-xs font-medium text-amber-800 hover:underline"
              >
                Retry Check
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Tracked Competitors</h1>
          <p className="text-zinc-500 text-sm">Manage real estate projects to monitor for price and construction updates.</p>
        </div>
        <div className="flex gap-3">
          {selectedProjects.size > 0 && (
            <button 
              onClick={handleBulkScrape}
              disabled={scrapingIds.size > 0}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              {scrapingIds.size > 0 ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Research Selected ({selectedProjects.size})
            </button>
          )}
          <button 
            onClick={() => {
              setFormData({ name: '', location: '', official_url: '', rera_registration_number: '' });
              setEditingId(null);
              setFormError(null);
              setIsAdding(!isAdding);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 text-sm font-medium transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Project
          </button>
        </div>
      </div>

      {/* Add / Edit Form Modal / Card */}
      {isAdding && (
        <div className="bg-white p-6 rounded-2xl shadow-md border border-zinc-200 transition-all">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-100">
            <h2 className="text-lg font-semibold text-zinc-900">
              {editingId ? 'Edit Competitor Project' : 'Add New Competitor Project'}
            </h2>
            <button 
              type="button" 
              onClick={() => { setIsAdding(false); setEditingId(null); setFormError(null); }}
              className="text-xs text-zinc-400 hover:text-zinc-700 font-medium"
            >
              Close
            </button>
          </div>

          {/* Inline Form Error Banner */}
          {formError && (
            <div className="mb-4 p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-900 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-red-950">Failed to save project to Supabase:</p>
                <p className="font-mono text-[11px] text-red-700">{formError}</p>
                <p className="text-[11px] text-red-600">
                  Tip: Check your database credentials and make sure the <code>projects</code> table exists in your Supabase project (see <Link to="/settings" className="underline font-semibold">Settings</Link>).
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Project Name <span className="text-red-500">*</span>
              </label>
              <input 
                required
                type="text" 
                placeholder="e.g. My Home Akrida, Aparna Sarovar"
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Location / Micro-Market</label>
              <input 
                type="text" 
                placeholder="e.g. Tellapur, Neopolis, Financial District"
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm"
                value={formData.location}
                onChange={e => setFormData({...formData, location: e.target.value})}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Landing Page URLs (comma-separated)
              </label>
              <textarea 
                rows={2}
                placeholder="https://project-microsite.com, https://builder.com/project"
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none resize-y text-xs font-mono"
                value={formData.official_url}
                onChange={e => setFormData({...formData, official_url: e.target.value})}
              />
              <p className="text-[11px] text-zinc-500 mt-1">Add project URLs or developer site links for web scraping.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">RERA Registration Number (Optional)</label>
              <input 
                type="text" 
                placeholder="e.g. P02400003456"
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm font-mono"
                value={formData.rera_registration_number}
                onChange={e => setFormData({...formData, rera_registration_number: e.target.value})}
              />
            </div>
            <div className="md:col-span-2 flex justify-end gap-3 mt-3 pt-3 border-t border-zinc-100">
              <button 
                type="button"
                disabled={submitting}
                onClick={() => {
                  setIsAdding(false);
                  setEditingId(null);
                  setFormError(null);
                }}
                className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 rounded-lg text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button 
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-xs font-semibold transition-colors shadow-sm"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {submitting ? 'Saving to Supabase...' : editingId ? 'Update Project' : 'Save Project'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Fetch Error Banner if loading failed */}
      {fetchError && !isSupabaseIssue && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-900 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{fetchError}</span>
          </div>
          <button 
            onClick={fetchProjects} 
            className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded font-semibold transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Project Cards Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-16 space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
          <p className="text-xs text-zinc-500">Loading projects from Supabase...</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl shadow-sm border border-zinc-200 text-center space-y-4">
          <div className="w-12 h-12 bg-zinc-100 text-zinc-400 rounded-2xl flex items-center justify-center mx-auto">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-zinc-900">No Projects Found</h3>
            <p className="text-xs text-zinc-500 max-w-md mx-auto mt-1">
              {isSupabaseIssue 
                ? "Your app is not connected to a working Supabase database. Please check your Supabase URL & Anon Key in Settings." 
                : "No competitor projects have been added yet. Click 'Add Project' to begin tracking."}
            </p>
          </div>
          <div>
            {isSupabaseIssue ? (
              <Link
                to="/settings"
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-xs font-semibold transition-colors"
              >
                Go to Settings
              </Link>
            ) : (
              <button 
                onClick={() => {
                  setFormData({ name: '', location: '', official_url: '', rera_registration_number: '' });
                  setEditingId(null);
                  setIsAdding(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 text-xs font-semibold transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Your First Project
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4 px-1">
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 cursor-pointer select-none">
              <input 
                type="checkbox" 
                className="w-4 h-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                checked={selectedProjects.size === projects.length && projects.length > 0}
                onChange={toggleAll}
              />
              Select All ({projects.length})
            </label>
            <span className="text-xs text-zinc-400">
              {projects.length} project{projects.length === 1 ? '' : 's'} tracked in Supabase
            </span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map(project => (
              <div 
                key={project.id} 
                className={`bg-white p-6 rounded-2xl shadow-sm border transition-colors flex flex-col ${
                  selectedProjects.has(project.id) ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-zinc-200'
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-start gap-3">
                    <input 
                      type="checkbox" 
                      className="mt-1 w-4 h-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                      checked={selectedProjects.has(project.id)}
                      onChange={() => toggleProject(project.id)}
                    />
                    <div>
                      <h3 className="text-base font-bold text-zinc-900 leading-tight">{project.name}</h3>
                      <p className="text-xs text-zinc-500 mt-1">{project.location || 'Location not specified'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => handleEditClick(project)}
                      className="p-1.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Edit Project"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={() => handleDelete(project.id)}
                      className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete Project"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                
                <div className="space-y-2 mb-6 flex-1 pl-7 text-xs">
                  {project.official_url && (
                    <div className="flex items-center gap-2 text-zinc-600">
                      <Globe className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      <a href={project.official_url.split(',')[0]} target="_blank" rel="noreferrer" className="hover:text-emerald-600 truncate font-mono">
                        {project.official_url}
                      </a>
                    </div>
                  )}
                  {project.rera_registration_number && (
                    <div className="flex items-center gap-2 text-zinc-600">
                      <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      <span className="truncate font-mono">RERA: {project.rera_registration_number}</span>
                    </div>
                  )}
                </div>

                <button 
                  onClick={() => handleScrape(project.id)}
                  disabled={scrapingIds.has(project.id)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-100 text-zinc-700 rounded-lg hover:bg-zinc-200 disabled:opacity-50 text-xs font-semibold transition-colors"
                >
                  {scrapingIds.has(project.id) ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Researching...
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      Run Research
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Bulk Scrape Floating Widget */}
      {bulkProgress && (
        <div className="fixed bottom-6 right-6 bg-white p-5 rounded-2xl shadow-2xl border border-zinc-200 z-50 min-w-[340px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-zinc-900 flex items-center gap-2">
              {bulkProgress.isComplete ? (
                <span className="text-emerald-600 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Research Complete
                </span>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                  Bulk Researching...
                </>
              )}
            </h3>
            <span className="text-xs font-medium text-zinc-500">{bulkProgress.current} / {bulkProgress.total}</span>
          </div>
          {!bulkProgress.isComplete && (
            <p className="text-xs text-zinc-600 mb-3 truncate" title={bulkProgress.projectName}>
              Processing: <span className="font-semibold">{bulkProgress.projectName}</span>
            </p>
          )}
          <div className="w-full bg-zinc-100 rounded-full h-2 mb-3 overflow-hidden">
            <div 
              className="h-2 rounded-full transition-all duration-300 ease-out bg-emerald-500"
              style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-xs font-medium mb-3">
            <span className="text-emerald-600">Success: {bulkProgress.success}</span>
            <span className="text-red-600">Failed: {bulkProgress.fail}</span>
          </div>
          {bulkProgress.isComplete && (
            <button
              onClick={() => setBulkProgress(null)}
              className="w-full py-2 bg-zinc-100 text-zinc-700 rounded-lg hover:bg-zinc-200 text-xs font-medium transition-colors"
            >
              Close
            </button>
          )}
        </div>
      )}
    </div>
  );
}
