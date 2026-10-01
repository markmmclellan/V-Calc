import { useRef, useState, useSyncExternalStore } from 'react';
import type { PokemonSet } from '../lib/model';
import {
  addPreset,
  applyPreset,
  clearAllPresets,
  countPresets,
  deletePreset,
  exportPresets,
  getPresets,
  importPresets,
  presetKey,
  renamePreset,
  subscribePresets,
  updatePreset,
} from '../lib/presets';

interface Props {
  set: PokemonSet;
  onChange: (s: PokemonSet) => void;
}

/** Save / apply custom builds for this Pokemon (shared by all its forms). Stored in localStorage. */
export default function PresetBar({ set, onChange }: Props) {
  const store = useSyncExternalStore(subscribePresets, getPresets);
  const list = store[presetKey(set.species)] ?? [];
  const total = countPresets(store);
  const [selectedId, setSelectedId] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const noteTimer = useRef<number>(undefined);
  // A selection from another Pokemon (or a deleted preset) simply doesn't match any entry here.
  const current = list.find((p) => p.id === selectedId);

  const flash = (msg: string) => {
    setNote(msg);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(''), 2000);
  };

  const save = () => {
    const name = window.prompt('Preset name', `${set.species} build ${list.length + 1}`)?.trim();
    if (!name) return;
    setSelectedId(addPreset(set, name));
    flash('Saved');
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportPresets()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'v-calc-presets.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const n = importPresets(await file.text());
      flash(n ? `Imported ${n}` : 'Nothing new to import');
    } catch (e) {
      window.alert(`Couldn't import presets: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div className="preset-bar">
      <select
        value={current?.id ?? ''}
        title="Apply a saved build for this Pokémon"
        onChange={(e) => {
          const p = list.find((x) => x.id === e.target.value);
          setSelectedId(e.target.value);
          if (p) onChange(applyPreset(set, p));
        }}
      >
        <option value="">{list.length ? `Presets (${list.length})` : 'No presets'}</option>
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button onClick={save} title="Save the current build as a new preset">
        Save
      </button>
      <button
        disabled={!current}
        onClick={() => {
          if (!current) return;
          updatePreset(set, current.id);
          flash('Updated');
        }}
        title="Overwrite the selected preset with the current build"
      >
        Update
      </button>
      <button
        className="icon"
        disabled={!current}
        aria-label="Rename preset"
        title="Rename the selected preset"
        onClick={() => {
          const name = current && window.prompt('Rename preset', current.name)?.trim();
          if (current && name) renamePreset(set.species, current.id, name);
        }}
      >
        ✎
      </button>
      <button
        className="icon"
        disabled={!current}
        aria-label="Delete preset"
        title="Delete the selected preset"
        onClick={() => {
          if (current && window.confirm(`Delete preset "${current.name}"?`)) deletePreset(set.species, current.id);
        }}
      >
        ✕
      </button>
      <button
        className="icon danger"
        disabled={total === 0}
        aria-label="Delete all presets"
        title={total ? `Delete all ${total} saved preset${total === 1 ? '' : 's'} for every Pokémon` : 'No presets to delete'}
        onClick={() => {
          if (!total) return;
          const ok = window.confirm(
            `Delete all ${total} saved preset${total === 1 ? '' : 's'} for every Pokémon?

This can't be undone. Use the export button (⇩) first if you want a backup.`,
          );
          if (!ok) return;
          clearAllPresets();
          setSelectedId('');
          flash('Cleared all');
        }}
      >
        Clear all
      </button>
      <button className="icon" aria-label="Export presets" title="Export all presets to a file" onClick={download}>
        ⇩
      </button>
      <button className="icon" aria-label="Import presets" title="Import presets from a file" onClick={() => fileRef.current?.click()}>
        ⇧
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {note && <span className="preset-note">{note}</span>}
    </div>
  );
}
