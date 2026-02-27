import { useState, useEffect, useRef } from 'react';
import { Building2, RefreshCw, Download, Printer, Settings2, Save, X, CalendarClock } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

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

const ALL_ATTRIBUTES = [
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

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingWeekly, setSavingWeekly] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const [visibleProjectIds, setVisibleProjectIds] = useState<Set<string>>(new Set());
  const [visibleAttributeKeys, setVisibleAttributeKeys] = useState<Set<string>>(new Set(ALL_ATTRIBUTES.map(a => a.key)));
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);

  const tableRef = useRef<HTMLDivElement>(null);

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
      const fetchedProjects = await projectsRes.json();
      setProjects(fetchedProjects);
      setSnapshots(await snapshotsRes.json());

      const savedView = localStorage.getItem('dashboardView');
      if (savedView) {
        const parsed = JSON.parse(savedView);
        if (parsed.projects) setVisibleProjectIds(new Set(parsed.projects));
        if (parsed.attributes) setVisibleAttributeKeys(new Set(parsed.attributes));
      } else {
        setVisibleProjectIds(new Set(fetchedProjects.map((p: Project) => p.id)));
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveView = () => {
    localStorage.setItem('dashboardView', JSON.stringify({
      projects: Array.from(visibleProjectIds),
      attributes: Array.from(visibleAttributeKeys)
    }));
    alert('View saved successfully!');
  };

  const handleSaveWeeklyUpdate = async () => {
    setSavingWeekly(true);
    try {
      const dataToSave = {
        projects: displayedProjects,
        snapshots: snapshots.filter(s => visibleProjectIds.has(s.project_id)),
        attributes: displayedAttributes
      };
      
      const res = await fetch('/api/weekly_updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dataToSave })
      });
      
      if (res.ok) {
        alert('Saved to Weekly Updates successfully!');
      } else {
        throw new Error('Failed to save');
      }
    } catch (error) {
      console.error(error);
      alert('Failed to save weekly update.');
    } finally {
      setSavingWeekly(false);
    }
  };

  const getSnapshotForProject = (projectId: string) => {
    return snapshots.find(s => s.project_id === projectId);
  };

  const displayedProjects = projects.filter(p => visibleProjectIds.has(p.id));
  const displayedAttributes = ALL_ATTRIBUTES.filter(a => visibleAttributeKeys.has(a.key));

  const handleExportCSV = () => {
    const headers = ['Attributes', ...displayedProjects.map(p => `"${p.name.replace(/"/g, '""')}"`)];
    const rows = displayedAttributes.map(attr => {
      const rowData = [attr.label];
      displayedProjects.forEach(project => {
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
    displayedProjects.forEach(project => {
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

  const handlePrint = async () => {
    if (!tableRef.current) return;
    setGeneratingPdf(true);
    try {
      const canvas = await html2canvas(tableRef.current, {
        scale: 2,
        useCORS: true,
        logging: false
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`competitive_benchmarking_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error('Failed to generate PDF', error);
      alert('Failed to generate PDF');
    } finally {
      setGeneratingPdf(false);
    }
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
        <div className="flex items-center gap-3 print-hidden flex-wrap justify-end">
          <button 
            onClick={() => setIsCustomizeOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 text-sm font-medium transition-colors"
          >
            <Settings2 className="w-4 h-4" />
            Customize
          </button>
          <button 
            onClick={handleSaveView}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 text-sm font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            Save View
          </button>
          <button 
            onClick={handleSaveWeeklyUpdate}
            disabled={savingWeekly}
            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {savingWeekly ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
            Add to Weekly Updates
          </button>
          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button 
            onClick={handlePrint}
            disabled={generatingPdf}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {generatingPdf ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            Save as PDF
          </button>
          <button 
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {isCustomizeOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-zinc-200 flex justify-between items-center">
              <h2 className="text-lg font-bold text-zinc-900">Customize View</h2>
              <button onClick={() => setIsCustomizeOpen(false)} className="p-2 hover:bg-zinc-100 rounded-lg">
                <X className="w-5 h-5 text-zinc-500" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="font-semibold text-zinc-900 mb-4">Visible Projects</h3>
                <div className="space-y-2">
                  {projects.map(p => (
                    <label key={p.id} className="flex items-center gap-3">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                        checked={visibleProjectIds.has(p.id)}
                        onChange={(e) => {
                          const newSet = new Set(visibleProjectIds);
                          if (e.target.checked) newSet.add(p.id);
                          else newSet.delete(p.id);
                          setVisibleProjectIds(newSet);
                        }}
                      />
                      <span className="text-sm text-zinc-700">{p.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-zinc-900 mb-4">Visible Attributes</h3>
                <div className="space-y-2">
                  {ALL_ATTRIBUTES.map(a => (
                    <label key={a.key} className="flex items-center gap-3">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                        checked={visibleAttributeKeys.has(a.key)}
                        onChange={(e) => {
                          const newSet = new Set(visibleAttributeKeys);
                          if (e.target.checked) newSet.add(a.key);
                          else newSet.delete(a.key);
                          setVisibleAttributeKeys(newSet);
                        }}
                      />
                      <span className="text-sm text-zinc-700">{a.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-zinc-200 flex justify-end gap-3">
              <button 
                onClick={() => setIsCustomizeOpen(false)}
                className="px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 text-sm font-medium transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {displayedProjects.length === 0 ? (
        <div className="p-8 bg-white rounded-2xl border border-zinc-200 text-center text-zinc-500">
          No projects selected for comparison. Click "Customize" to select projects.
        </div>
      ) : (
        <div ref={tableRef} className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                <th className="p-4 border-b border-r border-zinc-200 bg-zinc-50 font-semibold text-zinc-700 w-48 sticky left-0 z-10">
                  Attributes
                </th>
                {displayedProjects.map(project => (
                  <th key={project.id} className="p-4 border-b border-zinc-200 bg-zinc-50 font-semibold text-zinc-900 min-w-[250px]">
                    {project.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayedAttributes.map((attr, idx) => (
                <tr key={attr.key} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="p-4 border-b border-r border-zinc-200 font-medium text-sm text-zinc-600 sticky left-0 bg-white z-10">
                    {attr.label}
                  </td>
                  {displayedProjects.map(project => {
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
                {displayedProjects.map(project => {
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
      )}
    </div>
  );
}
