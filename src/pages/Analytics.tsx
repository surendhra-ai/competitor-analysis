import { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  DollarSign, 
  Building2, 
  Map as MapIcon, 
  Layers, 
  Calendar,
  ChevronDown,
  RefreshCw,
  BarChart2,
  AlertCircle
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie
} from 'recharts';
import { getProjects, getHistoricalSnapshots, Project, Snapshot } from '../lib/dataService';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e'];

export default function Analytics() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPriceType, setSelectedPriceType] = useState<'base_price_per_sft' | 'landed_price_per_sft'>('base_price_per_sft');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [fetchedProjects, fetchedSnapshots] = await Promise.all([
        getProjects(),
        getHistoricalSnapshots()
      ]);
      setProjects(fetchedProjects);
      setSnapshots(fetchedSnapshots);
    } catch (error) {
      console.error('Failed to fetch analytics data', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <RefreshCw className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  // Map project ID to Name
  const projectMap = new Map<string, string>();
  projects.forEach(p => projectMap.set(p.id, p.name));

  // Filter snapshots if a specific project is selected
  const filteredSnapshots = snapshots.filter(s => 
    selectedProjectId === 'all' || s.project_id === selectedProjectId
  );

  // 1. Process data for Pricing Trends Line Chart
  // Group snapshots by date (or day/week) to create a cohesive timeline
  const timelineMap = new Map<string, any>();
  
  filteredSnapshots.forEach(snap => {
    if (!snap.scraped_at) return;
    const date = new Date(snap.scraped_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: '2-digit'
    });
    
    if (!timelineMap.has(date)) {
      timelineMap.set(date, { date, rawDate: new Date(snap.scraped_at).getTime() });
    }
    
    const entry = timelineMap.get(date);
    const pName = projectMap.get(snap.project_id) || 'Unknown';
    const price = snap[selectedPriceType];
    
    if (price !== null && price !== undefined) {
      entry[pName] = price;
    }
  });

  // Sort timeline chronologically
  const lineChartData = Array.from(timelineMap.values()).sort((a: any, b: any) => a.rawDate - b.rawDate);

  // 2. Process data for latest snapshots (bar chart / stats)
  const latestSnapshotsMap = new Map<string, Snapshot>();
  snapshots.forEach(s => {
    const existing = latestSnapshotsMap.get(s.project_id);
    if (!existing || new Date(s.scraped_at) > new Date(existing.scraped_at)) {
      latestSnapshotsMap.set(s.project_id, s);
    }
  });
  const latestSnapshots = Array.from(latestSnapshotsMap.values());

  // Aggregate stats
  const validPrices = latestSnapshots
    .map(s => s[selectedPriceType])
    .filter((p): p is number => p !== null && p !== undefined && p > 0);
  
  const avgPrice = validPrices.length > 0 
    ? Math.round(validPrices.reduce((a, b) => a + b, 0) / validPrices.length) 
    : 0;
  
  const maxPrice = validPrices.length > 0 ? Math.max(...validPrices) : 0;
  const minPrice = validPrices.length > 0 ? Math.min(...validPrices) : 0;

  const totalUnits = latestSnapshots.reduce((acc, curr) => acc + (curr.no_of_units || 0), 0);
  const totalLand = latestSnapshots.reduce((acc, curr) => acc + (curr.land_area_acres || 0), 0);

  // 3. Data for Land Area Bar Chart
  const landData = projects.map(p => {
    const snap = latestSnapshotsMap.get(p.id);
    return {
      name: p.name,
      acres: snap?.land_area_acres || 0,
      units: snap?.no_of_units || 0
    };
  }).filter(d => d.acres > 0 || d.units > 0);

  // 4. Data for Units Distribution Pie Chart
  const pieData = landData.map((d, index) => ({
    name: d.name,
    value: d.units,
    color: COLORS[index % COLORS.length]
  })).filter(d => d.value > 0);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-zinc-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Competitor Insights & Trends</h1>
          <p className="text-zinc-500 text-sm">Visualize competitor price movements, scaling, and physical developments.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Project Filter */}
          <div className="relative">
            <select
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
              className="appearance-none pl-4 pr-10 py-2 bg-white border border-zinc-200 rounded-xl text-sm font-medium text-zinc-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all cursor-pointer"
            >
              <option value="all">All Tracked Projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
          </div>

          {/* Price Type Selector */}
          <div className="flex bg-zinc-100 p-1 rounded-xl">
            <button
              onClick={() => setSelectedPriceType('base_price_per_sft')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                selectedPriceType === 'base_price_per_sft'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              Base Price
            </button>
            <button
              onClick={() => setSelectedPriceType('landed_price_per_sft')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                selectedPriceType === 'landed_price_per_sft'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              Landed Price
            </button>
          </div>

          {/* Refresh */}
          <button 
            onClick={fetchData}
            className="p-2 bg-white border border-zinc-200 rounded-xl hover:bg-zinc-50 transition-colors text-zinc-600"
            title="Refresh analytics data"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Average Price</p>
            <h3 className="text-xl font-bold text-zinc-950 mt-1">
              {avgPrice > 0 ? `₹${avgPrice.toLocaleString()}/sft` : 'N/A'}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">Across active listings</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Highest Price</p>
            <h3 className="text-xl font-bold text-zinc-950 mt-1">
              {maxPrice > 0 ? `₹${maxPrice.toLocaleString()}/sft` : 'N/A'}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">Market peak ceiling</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Total Supply</p>
            <h3 className="text-xl font-bold text-zinc-950 mt-1">
              {totalUnits > 0 ? `${totalUnits.toLocaleString()} Units` : 'N/A'}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">Across tracked projects</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
            <MapIcon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Total Footprint</p>
            <h3 className="text-xl font-bold text-zinc-950 mt-1">
              {totalLand > 0 ? `${totalLand.toFixed(2)} Acres` : 'N/A'}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">Physical land area</p>
          </div>
        </div>
      </div>

      {/* Main Trends Line Chart */}
      <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-lg font-bold text-zinc-950">Pricing Trajectory Over Time</h2>
            <p className="text-zinc-500 text-xs">Visualize and contrast individual competitor price escalations.</p>
          </div>
          <div className="text-xs font-medium bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full">
            ₹ / Sq.Ft
          </div>
        </div>
        
        {lineChartData.length === 0 ? (
          <div className="h-[350px] flex flex-col items-center justify-center border border-dashed border-zinc-200 rounded-xl bg-zinc-50/50 p-6 text-center text-zinc-400">
            <AlertCircle className="w-8 h-8 mb-2 text-zinc-300" />
            <p className="text-sm font-medium">Insufficient pricing timeline data</p>
            <p className="text-xs max-w-xs mt-1">Scrape competitor URLs multiple times over different days/weeks to populate historical trajectory trends.</p>
          </div>
        ) : (
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={lineChartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                <XAxis 
                  dataKey="date" 
                  tickLine={false} 
                  axisLine={false} 
                  stroke="#a1a1aa" 
                  fontSize={11} 
                  dy={10}
                />
                <YAxis 
                  tickLine={false} 
                  axisLine={false} 
                  stroke="#a1a1aa" 
                  fontSize={11}
                  dx={-10}
                  tickFormatter={(val) => `₹${val.toLocaleString()}`}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#18181b', 
                    borderRadius: '12px', 
                    border: 'none',
                    color: '#fff',
                    fontSize: '12px'
                  }} 
                  itemStyle={{ color: '#fff' }}
                  labelStyle={{ fontWeight: 'bold', color: '#10b981', marginBottom: '4px' }}
                />
                <Legend 
                  verticalAlign="top" 
                  height={36} 
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: '12px', fontWeight: 500 }}
                />
                {projects.map((proj, idx) => (
                  <Line
                    key={proj.id}
                    type="monotone"
                    dataKey={proj.name}
                    stroke={COLORS[idx % COLORS.length]}
                    strokeWidth={2.5}
                    dot={{ r: 4, strokeWidth: 1 }}
                    activeDot={{ r: 6 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Distribution Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Land Size and Unit Capacity comparison */}
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-zinc-950">Scale & Capacity Benchmarking</h3>
            <p className="text-zinc-500 text-xs mb-6">Compare total land footprints against unit density allocations.</p>
          </div>
          
          {landData.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-zinc-400 text-sm">
              No physical scale data available.
            </div>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={landData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} stroke="#a1a1aa" fontSize={11} dy={10} />
                  <YAxis yAxisId="left" tickLine={false} axisLine={false} stroke="#a1a1aa" fontSize={11} dx={-10} label={{ value: 'Acres', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#a1a1aa', fontSize: 10 } }} />
                  <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} stroke="#a1a1aa" fontSize={11} dx={10} label={{ value: 'Units', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: '#a1a1aa', fontSize: 10 } }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#18181b', 
                      borderRadius: '12px', 
                      border: 'none',
                      color: '#fff',
                      fontSize: '12px'
                    }} 
                  />
                  <Legend verticalAlign="top" height={36} iconType="rect" iconSize={12} wrapperStyle={{ fontSize: '11px' }} />
                  <Bar yAxisId="left" dataKey="acres" name="Land Area (Acres)" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="units" name="Total Units" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Volume of Inventory Market Share */}
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-zinc-950">Market Inventory Share</h3>
            <p className="text-zinc-500 text-xs mb-6">Distribution of active competitor volume/units tracked in market.</p>
          </div>
          
          {pieData.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-zinc-400 text-sm">
              No inventory data available.
            </div>
          ) : (
            <div className="h-[280px] flex flex-col sm:flex-row items-center gap-6">
              <div className="w-full sm:w-1/2 h-full">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => `${value.toLocaleString()} Units`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full sm:w-1/2 space-y-3">
                {pieData.map((d, index) => {
                  const total = pieData.reduce((a, b) => a + b.value, 0);
                  const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
                  return (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                        <span className="font-semibold text-zinc-700 truncate max-w-[120px]">{d.name}</span>
                      </div>
                      <span className="text-zinc-500 font-medium">
                        {d.value.toLocaleString()} ({pct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Progress Timelines / Milestones */}
      <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
        <h3 className="text-lg font-bold text-zinc-950 mb-1">Development Milestones & Construction Progress</h3>
        <p className="text-zinc-500 text-xs mb-6">Current active development status, structural stages, and delivery projections.</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((proj, idx) => {
            const snap = latestSnapshotsMap.get(proj.id);
            const stage = snap?.construction_stage || 'Not reported';
            const handover = snap?.handover_date || 'Unknown';
            
            return (
              <div key={proj.id} className="p-5 border border-zinc-100 rounded-2xl bg-zinc-50/50 hover:bg-zinc-50 transition-all flex flex-col justify-between space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-zinc-900 text-sm">{proj.name}</h4>
                    <p className="text-xs text-zinc-400 mt-0.5">{proj.location || 'Telangana, India'}</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-200/60 text-zinc-600 uppercase">
                    Stage {idx + 1}
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-xs">
                    <Layers className="w-4 h-4 text-emerald-500" />
                    <div>
                      <p className="text-zinc-400 font-medium text-[10px] uppercase">Active Stage</p>
                      <p className="font-semibold text-zinc-700">{stage}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <Calendar className="w-4 h-4 text-blue-500" />
                    <div>
                      <p className="text-zinc-400 font-medium text-[10px] uppercase">Target Delivery</p>
                      <p className="font-semibold text-zinc-700">{handover}</p>
                    </div>
                  </div>
                </div>

                {/* Micro progress indicator bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-semibold text-zinc-400">
                    <span>PROGRESS</span>
                    <span>{stage.toLowerCase().includes('finishing') || stage.toLowerCase().includes('complete') ? '90%' : stage.toLowerCase().includes('superstructure') || stage.toLowerCase().includes('brickwork') ? '50%' : stage.toLowerCase().includes('foundation') || stage.toLowerCase().includes('excavation') ? '20%' : '10%'}</span>
                  </div>
                  <div className="w-full bg-zinc-200/60 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${idx % 3 === 0 ? 'bg-emerald-500' : idx % 3 === 1 ? 'bg-blue-500' : 'bg-amber-500'}`}
                      style={{ width: stage.toLowerCase().includes('finishing') || stage.toLowerCase().includes('complete') ? '90%' : stage.toLowerCase().includes('superstructure') || stage.toLowerCase().includes('brickwork') ? '50%' : stage.toLowerCase().includes('foundation') || stage.toLowerCase().includes('excavation') ? '20%' : '10%' }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
