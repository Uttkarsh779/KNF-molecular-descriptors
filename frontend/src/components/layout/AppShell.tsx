import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Play, BarChart3, Settings, BookOpen, ChevronLeft, ChevronRight, Atom, CircleDot } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/runs', label: 'Run Manager', icon: Play },
  { to: '/results', label: 'Results', icon: BarChart3 },
  { to: '/explorer', label: 'Explorer', icon: CircleDot },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/docs', label: 'Help', icon: BookOpen },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <div className="flex min-h-screen w-full bg-background bg-grid bg-gradient-radial bg-gradient-subtle">
      {/* Sidebar */}
      <aside
        className={cn(
          'sticky top-0 h-screen flex flex-col border-r border-border bg-sidebar transition-all duration-300 z-30',
          collapsed ? 'w-16' : 'w-60'
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-border shrink-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
            <Atom className="w-5 h-5 text-primary" />
          </div>
          {!collapsed && (
            <span className="font-display font-bold text-foreground text-lg tracking-tight">
              KNF Studio
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-1">
          {navItems.map((item, i) => {
            const active = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                  active
                    ? 'bg-primary/10 text-primary shadow-sm shadow-primary/5'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:translate-x-0.5'
                )}
                aria-current={active ? 'page' : undefined}
                style={{ animationDelay: `${i * 0.05}s` }}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center h-12 border-t border-border text-muted-foreground hover:text-foreground transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}
