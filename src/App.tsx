import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router';
import { LayoutDashboard, Settings, Building2, Activity } from 'lucide-react';
import { cn } from './lib/utils';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import SettingsPage from './pages/Settings';
import Deltas from './pages/Deltas';

function Sidebar() {
  const location = useLocation();
  
  const navItems = [
    { icon: LayoutDashboard, label: 'Comparison', path: '/' },
    { icon: Building2, label: 'Projects', path: '/projects' },
    { icon: Activity, label: 'Weekly Updates', path: '/deltas' },
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  return (
    <div className="w-64 bg-zinc-950 text-zinc-300 flex flex-col h-screen border-r border-zinc-800 print-hidden">
      <div className="p-6 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Building2 className="w-6 h-6 text-emerald-500" />
          RealIntel AI
        </h1>
      </div>
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl transition-colors",
                isActive 
                  ? "bg-zinc-800 text-white font-medium" 
                  : "hover:bg-zinc-900 hover:text-white"
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-zinc-800 text-xs text-zinc-500">
        Automated Competitor Intelligence
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-zinc-50 font-sans">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/deltas" element={<Deltas />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
