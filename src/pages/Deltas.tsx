import { useState, useEffect } from 'react';
import { Activity, ArrowUpRight, ArrowDownRight, Info } from 'lucide-react';

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

export default function Deltas() {
  const [deltas, setDeltas] = useState<Delta[]>([]);
  const [projects, setProjects] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [deltasRes, projectsRes] = await Promise.all([
          fetch('/api/deltas'),
          fetch('/api/projects')
        ]);
        
        const deltasData = await deltasRes.json();
        const projectsData = await projectsRes.json();
        
        const projMap: Record<string, string> = {};
        projectsData.forEach((p: Project) => {
          projMap[p.id] = p.name;
        });
        
        setProjects(projMap);
        setDeltas(deltasData);
      } catch (error) {
        console.error('Failed to fetch deltas', error);
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
  }, []);

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
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Weekly Updates</h1>
        <p className="text-zinc-500">AI-generated insights on competitor changes over time.</p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-zinc-200 rounded-2xl"></div>
          ))}
        </div>
      ) : deltas.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl shadow-sm border border-zinc-200 text-center">
          <Activity className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-zinc-900 mb-1">No Updates Yet</h3>
          <p className="text-zinc-500">
            Run the scraper multiple times on the same project to generate incremental updates.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
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
                <p className="text-zinc-700 text-sm leading-relaxed">
                  {delta.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
