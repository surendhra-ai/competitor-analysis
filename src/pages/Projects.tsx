import { useState, useEffect } from 'react';
import { Plus, Trash2, Globe, FileText, RefreshCw, Play, Pencil } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  location: string;
  official_url: string;
  rera_registration_number: string;
  created_at: string;
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [scrapingIds, setScrapingIds] = useState<Set<string>>(new Set());
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ current: number, total: number, projectName: string, success: number, fail: number, isComplete: boolean } | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    location: '',
    official_url: '',
    rera_registration_number: ''
  });

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      setProjects(await res.json());
    } catch (error) {
      console.error('Failed to fetch projects', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await fetch(`/api/projects/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
      } else {
        await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
      }
      setFormData({ name: '', location: '', official_url: '', rera_registration_number: '' });
      setIsAdding(false);
      setEditingId(null);
      fetchProjects();
    } catch (error) {
      console.error('Failed to save project', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure? This will delete all historical data for this project.')) return;
    try {
      await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      fetchProjects();
      
      // Remove from selection if deleted
      if (selectedProjects.has(id)) {
        const newSet = new Set(selectedProjects);
        newSet.delete(id);
        setSelectedProjects(newSet);
      }
    } catch (error) {
      console.error('Failed to delete project', error);
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

    // Process sequentially to avoid rate limiting
    for (let i = 0; i < projectArray.length; i++) {
      const id = projectArray[i];
      const project = projects.find(p => p.id === id);
      setBulkProgress(prev => prev ? { ...prev, current: i + 1, projectName: project?.name || 'Unknown' } : null);

      const success = await handleScrape(id, false);
      if (success) successCount++;
      else failCount++;

      setBulkProgress(prev => prev ? { ...prev, success: successCount, fail: failCount } : null);
    }
    
    setBulkProgress(prev => prev ? { ...prev, isComplete: true } : null);
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
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Tracked Projects</h1>
          <p className="text-zinc-500">Manage competitor projects to monitor.</p>
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
              setIsAdding(!isAdding);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Project
          </button>
        </div>
      </div>

      {isAdding && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200 mb-8">
          <h2 className="text-lg font-semibold mb-4">{editingId ? 'Edit Competitor' : 'Add New Competitor'}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Project Name</label>
              <input 
                required
                type="text" 
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Location</label>
              <input 
                type="text" 
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                value={formData.location}
                onChange={e => setFormData({...formData, location: e.target.value})}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-zinc-700 mb-1">Landing Page URLs (comma-separated)</label>
              <textarea 
                required
                rows={2}
                placeholder="https://project.com, https://project-landing.com"
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none resize-y"
                value={formData.official_url}
                onChange={e => setFormData({...formData, official_url: e.target.value})}
              />
              <p className="text-xs text-zinc-500 mt-1">Add multiple URLs separated by commas to scrape more data sources.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">RERA Number</label>
              <input 
                type="text" 
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                value={formData.rera_registration_number}
                onChange={e => setFormData({...formData, rera_registration_number: e.target.value})}
              />
            </div>
            <div className="md:col-span-2 flex justify-end gap-3 mt-2">
              <button 
                type="button"
                onClick={() => {
                  setIsAdding(false);
                  setEditingId(null);
                }}
                className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium transition-colors"
              >
                {editingId ? 'Update Project' : 'Save Project'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center p-8">
          <RefreshCw className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      ) : (
        <>
          {projects.length > 0 && (
            <div className="flex items-center mb-4 px-2">
              <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  checked={selectedProjects.size === projects.length && projects.length > 0}
                  onChange={toggleAll}
                />
                Select All Projects
              </label>
            </div>
          )}
          
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
                      <h3 className="text-lg font-bold text-zinc-900 leading-tight">{project.name}</h3>
                      <p className="text-sm text-zinc-500 mt-1">{project.location || 'Location not specified'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => handleEditClick(project)}
                      className="p-1 text-zinc-400 hover:text-blue-500 transition-colors"
                      title="Edit Project"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDelete(project.id)}
                      className="p-1 text-zinc-400 hover:text-red-500 transition-colors"
                      title="Delete Project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                <div className="space-y-2 mb-6 flex-1 pl-7">
                  <div className="flex items-center gap-2 text-sm text-zinc-600">
                    <Globe className="w-4 h-4 text-zinc-400 shrink-0" />
                    <a href={project.official_url} target="_blank" rel="noreferrer" className="hover:text-emerald-600 truncate">
                      {project.official_url}
                    </a>
                  </div>
                  {project.rera_registration_number && (
                    <div className="flex items-center gap-2 text-sm text-zinc-600">
                      <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
                      <span className="truncate">RERA: {project.rera_registration_number}</span>
                    </div>
                  )}
                </div>

                <button 
                  onClick={() => handleScrape(project.id)}
                  disabled={scrapingIds.has(project.id)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-100 text-zinc-700 rounded-lg hover:bg-zinc-200 disabled:opacity-50 text-sm font-medium transition-colors"
                >
                  {scrapingIds.has(project.id) ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Scraping...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Run Scraper
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {bulkProgress && (
        <div className="fixed bottom-6 right-6 bg-white p-5 rounded-xl shadow-2xl border border-zinc-200 z-50 min-w-[320px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
              {bulkProgress.isComplete ? (
                <span className="text-emerald-600 flex items-center gap-2">✅ Research Complete</span>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                  Bulk Researching...
                </>
              )}
            </h3>
            <span className="text-xs font-medium text-zinc-500">{bulkProgress.current} / {bulkProgress.total}</span>
          </div>
          {!bulkProgress.isComplete && (
            <p className="text-xs text-zinc-600 mb-4 truncate" title={bulkProgress.projectName}>
              Processing: <span className="font-semibold">{bulkProgress.projectName}</span>
            </p>
          )}
          <div className="w-full bg-zinc-100 rounded-full h-2 mb-3 overflow-hidden">
            <div 
              className={`h-2 rounded-full transition-all duration-300 ease-out ${bulkProgress.isComplete ? 'bg-emerald-500' : 'bg-emerald-500'}`}
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
              className="w-full py-2 bg-zinc-100 text-zinc-700 rounded-lg hover:bg-zinc-200 text-sm font-medium transition-colors"
            >
              Close
            </button>
          )}
        </div>
      )}
    </div>
  );
}
