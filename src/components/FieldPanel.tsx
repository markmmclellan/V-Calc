import { useEffect, useRef, useState } from 'react';
import type { FieldState, SideState, Terrain, Weather } from '../lib/calc';

interface Props {
  field: FieldState;
  onChange: (f: FieldState) => void;
}

const WEATHERS: Weather[] = ['', 'Sun', 'Rain', 'Sand', 'Snow'];
const TERRAINS: Terrain[] = ['', 'Electric', 'Grassy', 'Misty', 'Psychic'];

type Flag = Exclude<keyof SideState, 'spikes' | 'active' | 'isTailwind'>; // Tailwind is toggled in the Turn order panel

// label + tooltip for every per-side effect. Each one describes the Pokémon on that side (what it is under or has).
const INFO: Record<Flag, [string, string]> = {
  isReflect: ['Reflect', 'Halves physical damage to this side'],
  isLightScreen: ['Light Screen', 'Halves special damage to this side'],
  isAuroraVeil: ['Aurora Veil', 'Halves damage to this side'],
  isHelpingHand: ['Helping Hand', "This side's attacker gets x1.5 power"],
  isFriendGuard: ['Friend Guard', 'An ally reduces damage to this side by 25%'],
  isSteelySpirit: ['Steely Spirit', 'A Steely Spirit Pokémon is on this side: its Steel moves get x1.5 power'],
  isCharge: ['Charge', "This side's Pokémon used Charge: its next Electric move gets x2 power"],
  isSR: ['Stealth Rock', "Rock-type damage when this side's Pokémon enters"],
  isSaltCured: ['Salt Cure', 'Loses 1/16 max HP each turn (1/8 if Water or Steel)'],
  isSeeded: ['Leech Seed', 'Loses 1/8 max HP each turn'],
  isCurse: ['Curse', 'Cursed: loses 1/4 max HP each turn'],
  isBound: ['Bound', 'Trapped by Bind/Wrap/Fire Spin etc.: loses 1/8 max HP each turn'],
  hasBindingBand: ['Binding Band', 'The binder holds a Binding Band: binding damage is 1/6 instead of 1/8'],
  isIngrain: ['Ingrain', 'Recovers 1/16 max HP each turn'],
  isAquaRing: ['Aqua Ring', 'Recovers 1/16 max HP each turn'],
};
const SPIKES_TIP = "Damage when this side's grounded Pokémon enters: 1/8, 1/6 or 1/4 max HP for 1, 2 or 3 layers";

/** The few used most often stay one click away; everything else lives in the menu. */
const FAVORITES: Flag[] = ['isReflect', 'isLightScreen', 'isSR', 'isHelpingHand'];

const GROUPS: { title: string; keys: (Flag | 'spikes')[] }[] = [
  { title: 'Screens', keys: ['isAuroraVeil'] },
  { title: 'Hazards', keys: ['spikes'] },
  { title: 'Support', keys: ['isFriendGuard', 'isSteelySpirit', 'isCharge'] },
  { title: 'Damage over time', keys: ['isSaltCured', 'isSeeded', 'isCurse', 'isBound', 'hasBindingBand'] },
  { title: 'Recovery', keys: ['isIngrain', 'isAquaRing'] },
];

function SideFlags({ title, side, onChange }: { title: string; side: SideState; onChange: (s: SideState) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const setFlag = (k: Flag, on: boolean) => onChange({ ...side, [k]: on });
  const setSpikes = (n: number) => onChange({ ...side, spikes: n });

  // effects that are on and aren't one of the always-visible favorites
  const activeKeys = GROUPS.flatMap((g) => g.keys).filter((k) => (k === 'spikes' ? side.spikes > 0 : !!side[k]));

  return (
    <div className="side-flags" ref={rootRef}>
      <h4>{title}</h4>
      <div className="chips">
        {FAVORITES.map((k) => (
          <label key={k} className="chip" title={INFO[k][1]}>
            <input type="checkbox" checked={!!side[k]} onChange={(e) => setFlag(k, e.target.checked)} />
            {INFO[k][0]}
          </label>
        ))}
        {activeKeys.map((k) =>
          k === 'spikes' ? (
            <button key={k} className="fx-tag" title={`${SPIKES_TIP}. Click to remove.`} onClick={() => setSpikes(0)}>
              Spikes ×{side.spikes} <span aria-hidden="true">✕</span>
            </button>
          ) : (
            <button key={k} className="fx-tag" title={`${INFO[k][1]}. Click to remove.`} aria-label={`Remove ${INFO[k][0]}`} onClick={() => setFlag(k, false)}>
              {INFO[k][0]} <span aria-hidden="true">✕</span>
            </button>
          ),
        )}
        <span className="fx-anchor">
          <button className="fx-add" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Add another effect on this side">
            + Add effect
          </button>
          {open && (
            <div className="effects-pop" role="menu" aria-label={`Effects on ${title.toLowerCase()}`}>
              {GROUPS.map((g) => (
                <div key={g.title} className="fx-group">
                  <h5>{g.title}</h5>
                  <div className="fx-items">
                    {g.keys.map((k) =>
                      k === 'spikes' ? (
                        [1, 2, 3].map((n) => (
                          <button
                            key={n}
                            role="menuitemcheckbox"
                            aria-checked={side.spikes === n}
                            className={'fx-item' + (side.spikes === n ? ' on' : '')}
                            title={SPIKES_TIP}
                            onClick={() => setSpikes(side.spikes === n ? 0 : n)}
                          >
                            <span className="fx-check">{side.spikes === n ? '✓' : ''}</span>Spikes ×{n}
                          </button>
                        ))
                      ) : (
                        <button
                          key={k}
                          role="menuitemcheckbox"
                          aria-checked={!!side[k]}
                          className={'fx-item' + (side[k] ? ' on' : '')}
                          title={INFO[k][1]}
                          onClick={() => setFlag(k, !side[k])}
                        >
                          <span className="fx-check">{side[k] ? '✓' : ''}</span>
                          {INFO[k][0]}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </span>
      </div>
    </div>
  );
}

export default function FieldPanel({ field, onChange }: Props) {
  const patch = (p: Partial<FieldState>) => onChange({ ...field, ...p });
  return (
    <section className="panel field">
      <div className="field-top">
        <h2>Field</h2>
        <label className="inline">
          Weather
          <select value={field.weather} onChange={(e) => patch({ weather: e.target.value as Weather })}>
            {WEATHERS.map((w) => (
              <option key={w} value={w}>
                {w || 'None'}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          Terrain
          <select value={field.terrain} onChange={(e) => patch({ terrain: e.target.value as Terrain })}>
            {TERRAINS.map((t) => (
              <option key={t} value={t}>
                {t || 'None'}
              </option>
            ))}
          </select>
        </label>
        <label className="chip" title="Fairy Aura is on the field from a Pokémon not in this matchup (e.g. your Doubles partner): Fairy moves get x1.33. If either Pokémon shown has Fairy Aura, it's already counted.">
          <input type="checkbox" checked={!!field.isFairyAura} onChange={(e) => patch({ isFairyAura: e.target.checked })} />
          Fairy Aura
        </label>
        <label className="chip">
          <input type="checkbox" checked={field.isGravity} onChange={(e) => patch({ isGravity: e.target.checked })} />
          Gravity
        </label>
        <label className="chip">
          <input type="checkbox" checked={field.isMagicRoom} onChange={(e) => patch({ isMagicRoom: e.target.checked })} />
          Magic Room
        </label>
        <label className="chip">
          <input type="checkbox" checked={field.isWonderRoom} onChange={(e) => patch({ isWonderRoom: e.target.checked })} />
          Wonder Room
        </label>
      </div>
      <div className="field-sides">
        <SideFlags title="Your side" side={field.attackerSide} onChange={(s) => patch({ attackerSide: s })} />
        <SideFlags title="Opponent's side" side={field.defenderSide} onChange={(s) => patch({ defenderSide: s })} />
      </div>
    </section>
  );
}
