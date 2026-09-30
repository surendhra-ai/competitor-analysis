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
  Database,
  HardDrive
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
  localProjectCount?: number;
  tables?: {
    projects: boolean;
    project_snapshots: boolean;
    weekly_deltas: boolean;
  };
  projectCount?: number;
  error?: string | null;
}

async function fetchJsonSafely(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    if (text.trim().startsWith('<')) {
      throw new Error(`Server returned HTML error (Status ${res.status}). Verify your server routing.`);
    }
    throw new Error(`Failed to parse server response as JSON: ${text.slice(0, 150)}`);
  }
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
  const [syncingSupabase, setSyncingSupabase] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

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
      const data = await fetchJsonSafely(res);
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
      const data = await fetchJsonSafely(res);
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

  const handleSyncToSupabase = async () => {
    setSyncingSupabase(true);
    setSyncFeedback(null);
    try {
      const res = await fetch('/api/supabase/sync', { method: 'POST' });
      const data = await fetchJsonSafely(res);
      if (data.success) {
        setSyncFeedback(`Synced ${data.syncedCount} project(s) to Supabase!`);
        await fetchProjects();
        await checkSupabaseStatus();
        setTimeout(() => setSyncFeedback(null), 4000);
      } else {
        setSyncFeedback(`Sync error: ${data.error}`);
      }
    } catch (err: any) {
      setSyncFeedback(`Sync failed: ${err.message}`);
    } finally {
      setSyncingSupabase(false);
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

      const data = await fetchJsonSafely(res);

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
      const data = await fetchJsonSafely(res);
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
      const data = await fetchJsonSafely(res);
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

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      
      {/* Storage & Database Status Pill Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-white border border-zinc-200 rounded-2xl shadow-sm text-xs">
        <div className="flex items-center gap-2.5">
          {supabaseStatus?.connected ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Supabase Cloud Connected</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-800 border border-blue-200 rounded-full font-medium">
              <HardDrive className="w-3.5 h-3.5 text-blue-600" />
              <span>Built-in Local Database Active</span>
            </div>
          )}
          <span className="text-zinc-500">
            {projects.length} project(s) ready
          </span>
        </div>

        <div className="flex items-center gap-2">
          {supabaseStatus?.connected && (
            <button
              onClick={handleSyncToSupabase}
              disabled={syncingSupabase}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {syncingSupabase ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Sync Supabase
            </button>
          )}
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg text-xs font-medium transition-colors"
          >
            <Database className="w-3 h-3 text-zinc-500" />
            Database Settings
          </Link>
        </div>
      </div>

      {syncFeedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-medium text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          {syncFeedback}
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
                <p className="font-semibold text-red-950">Failed to save project:</p>
                <p className="font-mono text-[11px] text-red-700">{formError}</p>
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
                onChange={e => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Location / Micro-market
              </label>
              <input 
                type="text" 
                placeholder="e.g. Gachibowli, Tellapur, Hyderabad"
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm"
                value={formData.location}
                onChange={e => setFormData({ ...formData, location: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Official Website URLs
              </label>
              <input 
                type="text" 
                placeholder="https://example.com/project, https://builder.com/project"
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm font-mono text-xs"
                value={formData.official_url}
                onChange={e => setFormData({ ...formData, official_url: e.target.value })}
              />
              <p className="text-[11px] text-zinc-500 mt-1">Comma-separated URLs to scrape</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                RERA Registration Number
              </label>
              <input 
                type="text" 
                placeholder="P02400000000"
                className="w-full px-3.5 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm font-mono text-xs"
                value={formData.rera_registration_number}
                onChange={e => setFormData({ ...formData, rera_registration_number: e.target.value })}
              />
              <p className="text-[11px] text-zinc-500 mt-1">Used to verify against official RERA portals</p>
            </div>
            <div className="md:col-span-2 flex justify-end gap-3 mt-2">
              <button 
                type="button" 
                onClick={() => {
                  setIsAdding(false);
                  setEditingId(null);
                  setFormError(null);
                }}
                className="px-4 py-2 border border-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-50 transition-colors"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId ? (submitting ? 'Updating...' : 'Update Project') : (submitting ? 'Saving...' : 'Save Project')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Bulk Progress Banner */}
      {bulkProgress && (
        <div className="p-4 bg-zinc-900 text-white rounded-xl shadow-lg border border-zinc-800 flex flex-col gap-2">
          <div className="flex justify-between items-center text-sm font-medium">
            <span className="flex items-center gap-2">
              {!bulkProgress.isComplete && <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />}
              {bulkProgress.isComplete ? 'Bulk Research Finished' : `Researching: ${bulkProgress.projectName}`}
            </span>
            <span className="text-zinc-400 text-xs">
              {bulkProgress.current} of {bulkProgress.total} projects
            </span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
            <div 
              className="bg-emerald-500 h-full transition-all duration-300"
              style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-zinc-400">
            <span>Successful: <strong className="text-emerald-400">{bulkProgress.success}</strong></span>
            <span>Failed: <strong className="text-red-400">{bulkProgress.fail}</strong></span>
            {bulkProgress.isComplete && (
              <button 
                onClick={() => setBulkProgress(null)}
                className="text-zinc-300 hover:text-white underline"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {/* Projects List */}
      <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-zinc-500">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-zinc-400" />
            Loading tracked competitors...
          </div>
        ) : fetchError ? (
          <div className="p-8 text-center text-red-600 bg-red-50/50">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-red-500" />
            <p className="font-semibold text-sm">Failed to load projects</p>
            <p className="text-xs text-red-500 mt-1">{fetchError}</p>
            <button
              onClick={fetchProjects}
              className="mt-3 px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-xs font-medium"
            >
              Retry
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="p-12 text-center text-zinc-500 space-y-3">
            <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center mx-auto text-zinc-400">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <p className="font-semibold text-zinc-800">No competitor projects tracked yet</p>
              <p className="text-xs text-zinc-400 mt-1">Add your first project to start automated price and construction tracking.</p>
            </div>
            <button
              onClick={() => {
                setFormData({ name: '', location: '', official_url: '', rera_registration_number: '' });
                setEditingId(null);
                setIsAdding(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              Add First Project
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/75 text-zinc-500 text-xs font-semibold">
                  <th className="py-3 px-4 w-10 text-center">
                    <input 
                      type="checkbox"
                      className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                      checked={projects.length > 0 && selectedProjects.size === projects.length}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="py-3 px-4">Project Name</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4">Official URLs</th>
                  <th className="py-3 px-4">RERA Number</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {projects.map((project) => {
                  const isScraping = scrapingIds.has(project.id);
                  const isSelected = selectedProjects.has(project.id);
                  const urls = (project.official_url || '').split(',').map(u => u.trim()).filter(Boolean);

                  return (
                    <tr key={project.id} className={`hover:bg-zinc-50/50 transition-colors ${isSelected ? 'bg-emerald-50/20' : ''}`}>
                      <td className="py-3.5 px-4 text-center">
                        <input 
                          type="checkbox"
                          className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                          checked={isSelected}
                          onChange={() => toggleProject(project.id)}
                        />
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-zinc-900">
                        {project.name}
                      </td>
                      <td className="py-3.5 px-4 text-zinc-600 text-xs">
                        {project.location || <span className="text-zinc-400 italic">Not set</span>}
                      </td>
                      <td className="py-3.5 px-4">
                        {urls.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {urls.map((u, i) => (
                              <a 
                                key={i}
                                href={u} 
                                target="_blank" 
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-zinc-100 text-zinc-700 hover:bg-zinc-200 transition-colors"
                              >
                                <Globe className="w-3 h-3 text-zinc-400" />
                                {new URL(u).hostname.replace('www.', '')}
                                <ExternalLink className="w-2.5 h-2.5 text-zinc-400" />
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span className="text-zinc-400 text-xs italic">No URLs</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-zinc-600">
                        {project.rera_registration_number ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded border border-purple-100">
                            <FileText className="w-3 h-3" />
                            {project.rera_registration_number}
                          </span>
                        ) : (
                          <span className="text-zinc-400 italic font-sans">None</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleScrape(project.id)}
                            disabled={isScraping}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                            title="Scrape & Run AI Intelligence Extraction"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isScraping ? 'animate-spin' : ''}`} />
                            {isScraping ? 'Analyzing...' : 'Research'}
                          </button>
                          <button
                            onClick={() => handleEditClick(project)}
                            className="p-1.5 hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800 rounded-lg transition-colors"
                            title="Edit project details"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(project.id)}
                            className="p-1.5 hover:bg-red-50 text-zinc-400 hover:text-red-600 rounded-lg transition-colors"
                            title="Delete project"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
