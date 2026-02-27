import { useState, useEffect } from 'react';
import { CalendarClock, RefreshCw, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

interface WeeklyUpdate {
  id: number;
  timestamp: string;
  data: {
    projects: any[];
    snapshots: any[];
    attributes: any[];
  };
}

export default function WeeklyUpdates() {
  const [updates, setUpdates] = useState<WeeklyUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    fetchUpdates();
  }, []);

  const fetchUpdates = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/weekly_updates');
      setUpdates(await res.json());
    } catch (error) {
      console.error('Failed to fetch weekly updates', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this update?')) return;
    try {
      await fetch(`/api/weekly_updates/${id}`, { method: 'DELETE' });
      fetchUpdates();
    } catch (error) {
      console.error('Failed to delete update', error);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <RefreshCw className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Weekly Updates</h1>
          <p className="text-zinc-500">Historical snapshots of your dashboard views.</p>
        </div>
        <button 
          onClick={fetchUpdates}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 text-sm font-medium transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {updates.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-zinc-200 text-center text-zinc-500 flex flex-col items-center">
          <CalendarClock className="w-16 h-16 mb-4 text-zinc-300" />
          <h2 className="text-xl font-medium text-zinc-700 mb-2">No Weekly Updates</h2>
          <p>Go to the Dashboard and click "Add to Weekly Updates" to save a snapshot.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {updates.map(update => {
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
                        handleDelete(update.id);
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
    </div>
  );
}
