import { useState, useEffect } from 'react';
import { Building2, RefreshCw, Download, Printer } from 'lucide-react';

interface Project {
  id: string;
  name: string;
}

interface Snapshot {
  id: string;
  project_id: string;
  scraped_at: string;
  no_of_units: number | null;
  no_of_floors: number | null;
  land_area_acres: number | null;
  base_price_per_sft: number | null;
  landed_price_per_sft: number | null;
  construction_stage: string | null;
  handover_date: string | null;
  schemes: string[] | null;
  social_ads_summary: string | null;
}

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [projectsRes, snapshotsRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/snapshots/latest')
      ]);
      setProjects(await projectsRes.json());
      setSnapshots(await snapshotsRes.json());
    } catch (error) {
      console.error('Failed to fetch dashboard data', error);
    } finally {
      setLoading(false);
    }
  };

  const getSnapshotForProject = (projectId: string) => {
    return snapshots.find(s => s.project_id === projectId);
  };

  const attributes = [
    { key: 'no_of_units', label: 'Total Units' },
    { key: 'no_of_floors', label: 'Floors' },
    { key: 'land_area_acres', label: 'Land Area (Acres)' },
    { key: 'base_price_per_sft', label: 'Base Price (₹/sft)' },
    { key: 'landed_price_per_sft', label: 'Landed Price (₹/sft)' },
    { key: 'construction_stage', label: 'Construction Stage' },
    { key: 'handover_date', label: 'Handover Date' },
    { key: 'schemes', label: 'Active Schemes' },
    { key: 'social_ads_summary', label: 'Marketing Focus' },
  ];

  const handleExportCSV = () => {
    const headers = ['Attributes', ...projects.map(p => `"${p.name.replace(/"/g, '""')}"`)];
    const rows = attributes.map(attr => {
      const rowData = [attr.label];
      projects.forEach(project => {
        const snapshot = getSnapshotForProject(project.id);
        let value: any = snapshot ? (snapshot as any)[attr.key] : 'N/A';
        if (attr.key === 'schemes' && Array.isArray(value)) {
          value = value.length > 0 ? value.join('; ') : 'None detected';
        } else if (value === null || value === undefined) {
          value = 'N/A';
        }
        rowData.push(`"${String(value).replace(/"/g, '""')}"`);
      });
      return rowData.join(',');
    });

    const lastUpdatedRow = ['Last Updated'];
    projects.forEach(project => {
      const snapshot = getSnapshotForProject(project.id);
      const dateStr = snapshot ? new Date(snapshot.scraped_at).toLocaleString() : 'Never';
      lastUpdatedRow.push(`"${dateStr}"`);
    });
    rows.push(lastUpdatedRow.join(','));

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `competitive_benchmarking_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <RefreshCw className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="p-8 h-full flex flex-col items-center justify-center text-zinc-500">
        <Building2 className="w-16 h-16 mb-4 text-zinc-300" />
        <h2 className="text-xl font-medium text-zinc-700 mb-2">No Projects Tracked</h2>
        <p>Add competitor projects in the Projects tab to start tracking.</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Competitive Benchmarking</h1>
          <p className="text-zinc-500">Side-by-side comparison of latest scraped data.</p>
        </div>
        <div className="flex items-center gap-3 print-hidden">
          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button 
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 text-sm font-medium transition-colors"
          >
            <Printer className="w-4 h-4" />
            Save as PDF
          </button>
          <button 
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh View
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr>
              <th className="p-4 border-b border-r border-zinc-200 bg-zinc-50 font-semibold text-zinc-700 w-48 sticky left-0 z-10">
                Attributes
              </th>
              {projects.map(project => (
                <th key={project.id} className="p-4 border-b border-zinc-200 bg-zinc-50 font-semibold text-zinc-900 min-w-[250px]">
                  {project.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {attributes.map((attr, idx) => (
              <tr key={attr.key} className="hover:bg-zinc-50/50 transition-colors">
                <td className="p-4 border-b border-r border-zinc-200 font-medium text-sm text-zinc-600 sticky left-0 bg-white z-10">
                  {attr.label}
                </td>
                {projects.map(project => {
                  const snapshot = getSnapshotForProject(project.id);
                  let value: any = snapshot ? (snapshot as any)[attr.key] : null;
                  
                  if (attr.key === 'schemes' && Array.isArray(value)) {
                    value = value.length > 0 ? (
                      <ul className="list-disc pl-4 space-y-1">
                        {value.map((s, i) => <li key={i}>{s}</li>)}
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
            <tr>
              <td className="p-4 border-r border-zinc-200 font-medium text-sm text-zinc-600 sticky left-0 bg-white z-10">
                Last Updated
              </td>
              {projects.map(project => {
                const snapshot = getSnapshotForProject(project.id);
                return (
                  <td key={project.id} className="p-4 text-xs text-zinc-500 align-top">
                    {snapshot ? new Date(snapshot.scraped_at).toLocaleString() : 'Never'}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
