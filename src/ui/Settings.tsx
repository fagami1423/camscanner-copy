import { useEffect, useState } from 'preact/hooks';
import { getSettings, saveSettings } from '../store/store';
import type { Settings as SettingsT } from '../types';
import { reportError } from './errors';

export function Settings(props: { onBack: () => void }) {
  const [s, setS] = useState<SettingsT | null>(null);
  useEffect(() => {
    getSettings().then(setS, (e) => reportError(e, 'Could not load settings'));
  }, []);

  const update = async (patch: Partial<SettingsT>) => {
    if (!s) return;
    const next = { ...s, ...patch };
    setS(next);
    try {
      await saveSettings(next);
    } catch (e) {
      reportError(e, 'Could not save settings');
    }
  };

  return (
    <div class="screen">
      <header class="bar">
        <button type="button" class="btn" onClick={props.onBack}>
          ‹ Back
        </button>
        <h1>Settings</h1>
      </header>
      <main class="content settings">
        {s && (
          <>
            <label class="field">
              <span>PDF page size</span>
              <select value={s.pageSize} onChange={(e) => void update({ pageSize: e.currentTarget.value as SettingsT['pageSize'] })}>
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
              </select>
            </label>
            <label class="field field-check">
              <input type="checkbox" checked={s.autoCapture} onChange={(e) => void update({ autoCapture: e.currentTarget.checked })} />
              <span>Auto-capture by default</span>
            </label>
          </>
        )}
      </main>
    </div>
  );
}
