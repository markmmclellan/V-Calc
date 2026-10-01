import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PokemonSet } from '../lib/model';
import { cleanSet, deleteTeam, exportTeams, getTeams, importTeams, renameTeam, saveTeam, subscribeTeams, updateTeam } from '../lib/teams';
import Sprite from './Sprite';

interface Props {
  /** The team currently on this side (what "Save" stores). */
  sets: PokemonSet[];
  /** Replace this side's team with a saved one. */
  onLoad: (sets: PokemonSet[]) => void;
}

/** Saved named teams, shared by both sides (stored in localStorage). */
export default function TeamsMenu({ sets, onLoad }: Props) {
  const teams = useSyncExternalStore(subscribeTeams, getTeams);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const noteTimer = useRef<number>(undefined);

  // close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const flash = (msg: string) => {
    setNote(msg);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(''), 2000);
  };

  const save = () => {
    const n = name.trim();
    if (!n || !sets.length) return;
    saveTeam(n, sets);
    setName('');
    flash(`Saved “${n}”`);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportTeams()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'v-calc-teams.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const n = importTeams(await file.text());
      flash(n ? `Imported ${n} team${n === 1 ? '' : 's'}` : 'Nothing new to import');
    } catch (e) {
      window.alert(`Couldn't import teams: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div className="teams-menu" ref={rootRef}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Save this team, or load one you saved earlier">
        Teams ▾{teams.length ? ` (${teams.length})` : ''}
      </button>
      {open && (
        <div className="teams-pop" role="dialog" aria-label="Saved teams">
          <div className="teams-save">
            <input
              value={name}
              placeholder={sets.length ? 'Name this team…' : 'Add Pokémon to save a team'}
              disabled={!sets.length}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <button className="primary" disabled={!name.trim() || !sets.length} onClick={save}>
              Save
            </button>
          </div>

          {teams.length === 0 ? (
            <p className="hint teams-empty">No saved teams yet.</p>
          ) : (
            <ul className="teams-list">
              {teams.map((t) => (
                <li key={t.id}>
                  <div className="t-name" title={t.name}>
                    {t.name}
                  </div>
                  <div className="t-mons">
                    {t.sets.map((s, i) => (
                      <Sprite key={i} species={s.species} size={22} />
                    ))}
                  </div>
                  <div className="t-actions">
                    <button
                      onClick={() => {
                        onLoad(t.sets.map(cleanSet));
                        setOpen(false);
                      }}
                      title="Replace this side's team with this one"
                    >
                      Load
                    </button>
                    <button
                      disabled={!sets.length}
                      onClick={() => {
                        updateTeam(t.id, sets);
                        flash(`Updated “${t.name}”`);
                      }}
                      title="Overwrite this saved team with the team currently on this side"
                    >
                      Update
                    </button>
                    <button
                      className="icon"
                      aria-label={`Rename ${t.name}`}
                      title="Rename"
                      onClick={() => {
                        const n = window.prompt('Rename team', t.name)?.trim();
                        if (n) renameTeam(t.id, n);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="icon"
                      aria-label={`Delete ${t.name}`}
                      title="Delete"
                      onClick={() => window.confirm(`Delete saved team “${t.name}”?`) && deleteTeam(t.id)}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="teams-foot">
            <button className="icon" onClick={download} disabled={!teams.length} title="Export all saved teams to a file">
              ⇩ Export
            </button>
            <button className="icon" onClick={() => fileRef.current?.click()} title="Import teams from a file">
              ⇧ Import
            </button>
            {note && <span className="teams-note">{note}</span>}
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
          </div>
        </div>
      )}
    </div>
  );
}
