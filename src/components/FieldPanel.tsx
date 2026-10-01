import type { FieldState, SideState, Terrain, Weather } from '../lib/calc';

interface Props {
  field: FieldState;
  onChange: (f: FieldState) => void;
}

const WEATHERS: Weather[] = ['', 'Sun', 'Rain', 'Sand', 'Snow'];
const TERRAINS: Terrain[] = ['', 'Electric', 'Grassy', 'Misty', 'Psychic'];

// [flag, label, tooltip]. Every flag describes the Pokémon on that side (what it is under or has).
const SIDE_FLAGS: [keyof SideState, string, string][] = [
  ['isReflect', 'Reflect', 'Halves physical damage to this side'],
  ['isLightScreen', 'Light Screen', 'Halves special damage to this side'],
  ['isAuroraVeil', 'Aurora Veil', 'Halves damage to this side'],
  ['isHelpingHand', 'Helping Hand', "This side's attacker gets x1.5 power"],
  ['isFriendGuard', 'Friend Guard', 'An ally reduces damage to this side by 25%'],
  ['isSteelySpirit', 'Steely Spirit', 'A Steely Spirit Pokémon is on this side: its Steel moves get x1.5 power'],
  ['isCharge', 'Charge', "This side's Pokémon used Charge: its next Electric move gets x2 power"],
  ['isSR', 'Stealth Rock', "Rock-type damage when this side's Pokémon enters"],
  ['isSaltCured', 'Salt Cure', 'Loses 1/16 max HP each turn (1/8 if Water or Steel)'],
  ['isSeeded', 'Leech Seed', 'Loses 1/8 max HP each turn'],
  ['isCurse', 'Curse', 'Cursed: loses 1/4 max HP each turn'],
  ['isBound', 'Bound', 'Trapped by Bind/Wrap/Fire Spin etc.: loses 1/8 max HP each turn'],
  ['hasBindingBand', 'Binding Band', 'The binder holds a Binding Band: binding damage is 1/6 instead of 1/8'],
  ['isIngrain', 'Ingrain', 'Recovers 1/16 max HP each turn'],
  ['isAquaRing', 'Aqua Ring', 'Recovers 1/16 max HP each turn'],
];

function SideFlags({ title, side, onChange }: { title: string; side: SideState; onChange: (s: SideState) => void }) {
  return (
    <div className="side-flags">
      <h4>{title}</h4>
      <div className="chips">
        {SIDE_FLAGS.map(([k, label, tip]) => (
          <label key={k} className="chip" title={tip}>
            <input type="checkbox" checked={!!side[k]} onChange={(e) => onChange({ ...side, [k]: e.target.checked })} />
            {label}
          </label>
        ))}
        <label className="inline">
          Spikes
          <select value={side.spikes} onChange={(e) => onChange({ ...side, spikes: +e.target.value })}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
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
