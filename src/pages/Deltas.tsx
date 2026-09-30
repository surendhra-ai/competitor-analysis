import { useState, useEffect } from 'react';
import { Activity, ArrowUpRight, ArrowDownRight, Info, CalendarClock, Trash2, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';

interface Delta {
  id: string;
  project_id: string;
  change_type: string;
  description: string;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
}

interface WeeklyUpdate {
  id: number;
  timestamp: string;
  data: {
    projects: any[];
    snapshots: any[];
    attributes: any[];
  };
}

export default function Deltas() {
  const [activeTab, setActiveTab] = useState<'insights' | 'snapshots'>('insights');
  
  const [deltas, setDeltas] = useState<Delta[]>([]);
  const [projects, setProjects] = useState<Record<string, string>>({});
  const [loadingDeltas, setLoadingDeltas] = useState(true);

  const [savedUpdates, setSavedUpdates] = useState<WeeklyUpdate[]>([]);
  const [loadingUpdates, setLoadingUpdates] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    fetchDeltasData();
    fetchSavedUpdates();
  }, []);

  const fetchDeltasData = async () => {
    setLoadingDeltas(true);
    try {
      const [deltasRes, projectsRes] = await Promise.all([
        fetch('/api/deltas'),
        fetch('/api/projects')
      ]);
      
      const deltasData = await deltasRes.json();
      const projectsData = await projectsRes.json();
      
      const projMap: Record<string, string> = {};
      if (Array.isArray(projectsData)) {
        projectsData.forEach((p: Project) => {
          projMap[p.id] = p.name;
        });
      }
      
      setProjects(projMap);
      setDeltas(Array.isArray(deltasData) ? deltasData : []);
    } catch (error) {
      console.error('Failed to fetch deltas', error);
    } finally {
      setLoadingDeltas(false);
    }
  };

  const fetchSavedUpdates = async () => {
    setLoadingUpdates(true);
    try {
      const res = await fetch('/api/weekly_updates');
      setSavedUpdates(await res.json());
    } catch (error) {
      console.error('Failed to fetch weekly updates', error);
    } finally {
      setLoadingUpdates(false);
    }
  };

  const handleDeleteUpdate = async (id: number) => {
    if (!confirm('Are you sure you want to delete this saved view?')) return;
    try {
      await fetch(`/api/weekly_updates/${id}`, { method: 'DELETE' });
      fetchSavedUpdates();
    } catch (error) {
      console.error('Failed to delete update', error);
    }
  };

  const getIconForChangeType = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('hike') || t.includes('increase') || t.includes('up')) {
      return <ArrowUpRight className="w-5 h-5 text-red-500" />;
    }
    if (t.includes('drop') || t.includes('decrease') || t.includes('down')) {
      return <ArrowDownRight className="w-5 h-5 text-emerald-500" />;
    }
    return <Info className="w-5 h-5 text-blue-500" />;
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Weekly Updates</h1>
          <p className="text-zinc-500">Track competitor changes and historical snapshots.</p>
        </div>
        <div className="flex bg-zinc-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('insights')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'insights' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            AI Insights
          </button>
          <button
            onClick={() => setActiveTab('snapshots')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'snapshots' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            Saved Views
          </button>
        </div>
      </div>

      {activeTab === 'insights' && (
        <>
          {loadingDeltas ? (
            <div className="animate-pulse space-y-4 max-w-4xl">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 bg-zinc-200 rounded-2xl"></div>
              ))}
            </div>
          ) : deltas.length === 0 ? (
            <div className="bg-white p-12 rounded-2xl shadow-sm border border-zinc-200 text-center max-w-4xl">
              <Activity className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-zinc-900 mb-1">No Insights Yet</h3>
              <p className="text-zinc-500">
                Run the scraper multiple times on the same project to generate incremental updates.
              </p>
            </div>
          ) : (
            <div className="space-y-4 max-w-4xl">
              {deltas.map(delta => (
                <div key={delta.id} className="bg-white p-5 rounded-2xl shadow-sm border border-zinc-200 flex gap-4 items-start">
                  <div className="p-2 bg-zinc-50 rounded-xl border border-zinc-100 mt-1">
                    {getIconForChangeType(delta.change_type)}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-1">
                      <h3 className="font-semibold text-zinc-900">
                        {projects[delta.project_id] || 'Unknown Project'}
                      </h3>
                      <span className="text-xs font-medium text-zinc-500 bg-zinc-100 px-2 py-1 rounded-md">
                        {new Date(delta.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="inline-block px-2 py-0.5 bg-zinc-100 text-zinc-600 text-xs font-medium rounded mb-2">
                      {delta.change_type}
                    </div>
                    <p className="text-zinc-700 text-sm leading-relaxed">{delta.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'snapshots' && (
        <>
          {loadingUpdates ? (
            <div className="flex justify-center p-12">
              <RefreshCw className="w-8 h-8 animate-spin text-zinc-400" />
            </div>
          ) : savedUpdates.length === 0 ? (
            <div className="bg-white p-12 rounded-2xl border border-zinc-200 text-center text-zinc-500 flex flex-col items-center">
              <CalendarClock className="w-16 h-16 mb-4 text-zinc-300" />
              <h2 className="text-xl font-medium text-zinc-700 mb-2">No Saved Views</h2>
              <p>Go to the Dashboard and click "Add to Weekly Updates" to save a snapshot.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {savedUpdates.map(update => {
                const date = new Date(update.timestamp);
                const isExpanded = expandedId === update.id;
                const { projects, snapshots, attributes } = update.data;

                const getSnapshotForProject = (projectId: string) => {
                  return snapshots.find(s => s.project_id === projectId);
                };

                return (
                  <div key={update.id} className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
                    <div 
                      className="p-6 flex items-center justify-between cursor-pointer hover:bg-zinc-50 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : update.id)}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-bold">
                          {date.getDate()}
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-zinc-900">
                            {date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} Update
                          </h3>
                          <p className="text-sm text-zinc-500">
                            Saved at {date.toLocaleTimeString()} • {projects.length} projects
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteUpdate(update.id);
                          }}
                          className="p-2 text-zinc-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                          title="Delete Update"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                        {isExpanded ? <ChevronUp className="w-5 h-5 text-zinc-400" /> : <ChevronDown className="w-5 h-5 text-zinc-400" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-zinc-200 p-6 bg-zinc-50/50 overflow-x-auto">
                        <table className="w-full text-left border-collapse bg-white rounded-xl shadow-sm border border-zinc-200">
                          <thead>
                            <tr>
                              <th className="p-4 border-b border-r border-zinc-200 bg-zinc-50 font-semibold text-zinc-700 w-48">
                                Attributes
                              </th>
                              {projects.map((project: any) => (
                                <th key={project.id} className="p-4 border-b border-zinc-200 bg-zinc-50 font-semibold text-zinc-900 min-w-[200px]">
                                  {project.name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {attributes.map((attr: any) => (
                              <tr key={attr.key} className="hover:bg-zinc-50/50 transition-colors">
                                <td className="p-4 border-b border-r border-zinc-200 font-medium text-sm text-zinc-600">
                                  {attr.label}
                                </td>
                                {projects.map((project: any) => {
                                  const snapshot = getSnapshotForProject(project.id);
                                  let value: any = snapshot ? (snapshot as any)[attr.key] : null;
                                  
                                  if (attr.key === 'schemes' && Array.isArray(value)) {
                                    value = value.length > 0 ? (
                                      <ul className="list-disc pl-4 space-y-1">
                                        {value.map((s: string, i: number) => <li key={i}>{s}</li>)}
                                      </ul>
                                    ) : 'None detected';
                                  } else if (value === null || value === undefined) {
                                    value = <span className="text-zinc-400 italic">N/A</span>;
                                  }

                                  return (
                                    <td key={project.id} className="p-4 border-b border-zinc-200 text-sm text-zinc-800 align-top">
                                      {value}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
