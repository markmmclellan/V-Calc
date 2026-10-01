import { useEffect, useMemo, useRef, useState } from 'react';
import type { Meta } from '../lib/data';
import { setFromMeta, type BattleFormat } from '../lib/data';
import type { PokemonSet } from '../lib/model';
import { exportTeam, parsePaste, shareToPokepaste } from '../lib/showdown';
import Sprite from './Sprite';
import TeamsMenu from './TeamsMenu';

export interface Team {
  sets: PokemonSet[];
  /** The Pokémon being edited and calculated. In Doubles it is always on the field. */
  active: number;
  /** Doubles only: the second Pokémon on the field (spread moves lose power only with two targets). */
  partner?: number;
}

/** Select a Pokémon. Selecting the partner swaps the pair, so you can flip between the two on the field. */
export function focusSlot(t: Team, index: number): Team {
  if (index === t.active || index < 0 || index >= t.sets.length) return t;
  if (index === t.partner) return { ...t, active: index, partner: t.active };
  return { ...t, active: index };
}

/** Add or remove a Pokémon as the second one on the field. The selected Pokémon is always on the field already. */
export function togglePartner(t: Team, index: number): Team {
  if (index === t.active) return t;
  return { ...t, partner: t.partner === index ? undefined : index };
}

/** How many Pokémon a side has on the field: 2 only in Doubles with a partner picked. */
export function onFieldCount(t: Team, doubles: boolean): 1 | 2 {
  const p = t.partner;
  return doubles && p !== undefined && p !== t.active && p >= 0 && p < t.sets.length ? 2 : 1;
}

interface Props {
  title: string;
  team: Team;
  onChange: (t: Team) => void;
  meta: Meta | null;
  format: BattleFormat;
  side: 0 | 1;
}

export default function TeamSide({ title, team, onChange, meta, format, side }: Props) {
  const doubles = format === 'double';
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const copyTimer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const copyPaste = async () => {
    let state: 'ok' | 'fail' = 'ok';
    try {
      await navigator.clipboard.writeText(exportTeam(team.sets));
    } catch {
      state = 'fail';
    }
    setCopyState(state);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState('idle'), 2000);
  };

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!meta || !q) return [];
    return meta.entries.filter((e) => e.displayName.toLowerCase().includes(q)).slice(0, 8);
  }, [meta, search]);

  const doImport = (replace: boolean) => {
    const parsed = parsePaste(text);
    const warnings = [...parsed.warnings];
    if (!parsed.sets.length) return setWarnings(warnings);
    const kept = replace ? [] : team.sets;
    const room = 6 - kept.length;
    if (parsed.sets.length > room) {
      warnings.push(
        room > 0
          ? `Team is full: only the first ${room} of ${parsed.sets.length} pasted Pokémon were added.`
          : 'Team is full (6 Pokémon). Remove one or use "Replace team".',
      );
    }
    setWarnings(warnings);
    if (room <= 0) return;
    onChange({ sets: [...kept, ...parsed.sets.slice(0, room)], active: kept.length, partner: replace ? undefined : team.partner });
    setPasteOpen(false);
    setText('');
  };

  const addFromMeta = (i: number) => {
    const entry = matches[i];
    if (!entry || team.sets.length >= 6) return;
    const set = setFromMeta(entry, format);
    onChange({ ...team, sets: [...team.sets, set], active: team.sets.length });
    setSearch('');
    setWarnings([]);
  };

  const remove = (i: number) => {
    const sets = team.sets.filter((_, j) => j !== i);
    const shift = (n: number) => (n > i ? n - 1 : n); // keep the same Pokémon selected when an earlier one is removed
    const active = Math.max(0, team.active === i ? Math.min(i, sets.length - 1) : shift(team.active));
    let partner = team.partner === undefined || team.partner === i ? undefined : shift(team.partner);
    if (partner === active) partner = undefined;
    setWarnings([]);
    onChange({ sets, active, partner });
  };

  return (
    <section className="panel team">
      <header className="team-head">
        <h2>{title}</h2>
        <div className="row">
          <TeamsMenu sets={team.sets} onLoad={(sets) => onChange({ sets, active: 0 })} />
          <button
            onClick={() => {
              setPasteOpen((o) => !o);
              setWarnings([]);
            }}
          >{pasteOpen ? 'Cancel' : 'Import paste'}</button>
          <button
            className={copyState === 'ok' ? 'ok' : copyState === 'fail' ? 'fail' : ''}
            disabled={!team.sets.length}
            onClick={copyPaste}
            title="Copy team as a Showdown paste"
          >
            {copyState === 'ok' ? 'Copied ✓' : copyState === 'fail' ? 'Copy failed' : 'Copy paste'}
          </button>
          <button
            disabled={!team.sets.length}
            onClick={() => shareToPokepaste(team.sets, title)}
            title="Create a paste on pokepast.es and open it in a new tab"
          >
            Share to Pokepaste
          </button>
        </div>
      </header>

      {pasteOpen && (
        <div className="paste">
          <textarea
            rows={10}
            value={text}
            placeholder={'Paste a Showdown team here…\n\nGarchomp @ Garchompite Z\nAbility: Rough Skin\nEVs: 2 HP / 32 Atk / 32 Spe\nJolly Nature\n- Earthquake\n- Dragon Claw'}
            onChange={(e) => {
              setText(e.target.value);
              setWarnings([]);
            }}
          />
          <div className="row">
            <button className="primary" onClick={() => doImport(false)} disabled={!text.trim()}>
              Add to team
            </button>
            <button onClick={() => doImport(true)} disabled={!text.trim()} title="Discard this side's current team first">
              Replace team
            </button>
            <span className="hint">
              {team.sets.length}/6 slots used. Paste one Pokémon or a whole team.
            </span>
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="warnings-wrap">
          <ul className="warnings">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <button className="x" aria-label="Dismiss warnings" title="Dismiss" onClick={() => setWarnings([])}>
            ×
          </button>
        </div>
      )}

      <div className="slots">
        {team.sets.map((s, i) => (
          <div
            key={i}
            className={'slot' + (i === team.active ? ' active' : '') + (doubles && i === team.partner ? ' partner' : '')}
            onClick={() => onChange(focusSlot(team, i))}
            title={`${s.species} (press ${side === 1 ? 'Shift+' : ''}${i + 1})`}
          >
            <Sprite species={s.species} size={36} />
            <span className="slot-num">{i + 1}</span>
            <span className="slot-name">{s.nickname || s.species}</span>
            {doubles && i !== team.active && (
              <button
                className={'pair' + (i === team.partner ? ' on' : '')}
                aria-pressed={i === team.partner}
                aria-label={i === team.partner ? `Remove ${s.species} from the field` : `Put ${s.species} on the field as the second Pokémon`}
                title={i === team.partner ? 'On the field as the second Pokémon. Click to remove.' : 'Put on the field as the second Pokémon'}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(togglePartner(team, i));
                }}
              >
                {i === team.partner ? '2' : '＋'}
              </button>
            )}
            <button
              className="x"
              aria-label={`Remove ${s.species}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(i);
              }}
            >
              ×
            </button>
          </div>
        ))}
        {!team.sets.length && <p className="hint">No Pokémon yet. Import a paste or add one from the meta below.</p>}
      </div>
      {doubles && team.sets.length > 1 && (
        <p className="hint pair-hint">
          {onFieldCount(team, true) === 2
            ? 'Two on the field: spread moves hit both.'
            : 'One on the field. Press ＋ on a slot to add a second; with one, spread moves aren’t reduced.'}
        </p>
      )}

      <div className="add-meta">
        <input
          placeholder={meta ? 'Add from op.gg meta (type a name)…' : 'Loading meta…'}
          value={search}
          disabled={!meta || team.sets.length >= 6}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addFromMeta(0)}
        />
        {matches.length > 0 && (
          <ul className="suggest">
            {matches.map((m, i) => (
              <li key={m.key} onClick={() => addFromMeta(i)}>
                <Sprite species={m.species} size={28} />
                <span>{m.displayName}</span>
                <span className="rank">#{m.rank[format] ?? '–'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
