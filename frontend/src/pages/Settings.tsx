import { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import type { AppSettings } from '@/types';
import { useToast } from '@/hooks/use-toast';

const defaultSettings: AppSettings = {
  apiBaseUrl: 'http://localhost:8765',
  defaultProcessingMode: 'auto',
  defaultBackend: 'torch',
  defaultWorkers: 4,
  notificationsEnabled: true,
};

const SettingsPage = () => {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('knf-settings');
    return saved ? JSON.parse(saved) : defaultSettings;
  });
  const { toast } = useToast();

  const save = () => {
    localStorage.setItem('knf-settings', JSON.stringify(settings));
    toast({ title: 'Settings Saved', description: 'Your preferences have been updated.' });
  };

  return (
    <div className="p-6 lg:p-8 max-w-2xl space-y-6">
      <header className="animate-fade-in-up">
        <h1 className="text-2xl font-display font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure defaults and preferences</p>
      </header>

      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <Field label="API Base URL">
          <input type="text" value={settings.apiBaseUrl} onChange={e => setSettings(s => ({ ...s, apiBaseUrl: e.target.value }))} className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground font-mono focus:ring-1 focus:ring-ring outline-none" />
        </Field>
        <Field label="Default Processing Mode">
          <select value={settings.defaultProcessingMode} onChange={e => setSettings(s => ({ ...s, defaultProcessingMode: e.target.value as AppSettings['defaultProcessingMode'] }))} className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-ring outline-none">
            <option value="auto">Auto</option>
            <option value="single">Single</option>
            <option value="multi">Multi</option>
          </select>
        </Field>
        <Field label="Default Backend">
          <select value={settings.defaultBackend} onChange={e => setSettings(s => ({ ...s, defaultBackend: e.target.value as 'torch' | 'multiwfn' }))} className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-ring outline-none">
            <option value="torch">Torch</option>
            <option value="multiwfn">Multiwfn</option>
          </select>
        </Field>
        <Field label="Default Workers">
          <input type="number" value={settings.defaultWorkers} onChange={e => setSettings(s => ({ ...s, defaultWorkers: +e.target.value }))} className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground font-mono focus:ring-1 focus:ring-ring outline-none" />
        </Field>
        <label className="flex items-center justify-between text-sm cursor-pointer">
          <span className="text-foreground">Enable Notifications</span>
          <input type="checkbox" checked={settings.notificationsEnabled} onChange={e => setSettings(s => ({ ...s, notificationsEnabled: e.target.checked }))} className="rounded" />
        </label>
      </div>

      <button onClick={save} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity">
        <Save className="w-4 h-4" /> Save Settings
      </button>
    </div>
  );
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-muted-foreground mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export default SettingsPage;
