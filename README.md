# V-Calc

A damage and speed calculator for **Pokémon Champions**, in the style of the Pokémon Showdown calc. It pulls live
usage data from [op.gg](https://op.gg/pokemon-champions/tier) so you can apply popular moves, items, abilities,
natures and Stat Point spreads in one click, and you can load your own builds from Showdown pastes.

## Quick start

Requires [Node.js](https://nodejs.org/) 20.19 or newer (22 recommended).

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app. Enables the **Refresh op.gg data** button. |
| `npm run build` | Type-check and build the static site into `dist/`. |
| `npm run preview` | Serve the built site locally (the Refresh button works here too). |
| `npm run scrape` | Download fresh op.gg data into `public/data/champions.json` and Smogon's reference into `public/data/smogon.json`. |
| `npm run scrape:smogon` | Refresh only the Smogon reference (moves, items, abilities). |

## Features

- **Damage calculation** both ways at once, with roll ranges, KO chances and the usual Showdown-style description.
  It uses [`@smogon/calc`](https://github.com/smogon/damage-calc)'s native **Champions ruleset** (level 50, Stat Points,
  Champions move changes).
- **Turn order**: speed with stat stages, Choice Scarf, Tailwind, paralysis, weather and terrain speed abilities and
  Trick Room, plus priority moves.
- **Teams**: up to 6 per side, **Import paste**, **Copy paste**, **Share to Pokepaste**, and named **Teams** you can
  save and load onto either side. Press **1–6** to select your Pokémon and **Shift+1–6** for the opponent's.
  **Drag a Pokémon's slot onto another to reorder** the team (the numbers update, and your selection follows). The
  "Add from op.gg meta" box supports **↑ / ↓** to move through the suggestions, **Enter** to add and **Esc** to clear.
- **Most used**: the header's **Most used** button opens op.gg's tier ranking (Singles or Doubles) with a filter box
  (name or type) and **+ You** / **+ Opp** buttons that add a Pokémon, built from its top usage, straight to a team.
- **What to bring** (team preview): put the opponent's six into the Opponent team (the **Most used** list's **+ Opp**
  button is the quick way) and your six on your side, then press **What to bring**. It judges every pair 1v1 with the
  damage calculator (each side's best move, hits to KO, who moves first) and shows a 6×6 grid, then recommends the best
  **3 (Singles) or 4 (Doubles)**, a lead (or a lead pair in Doubles, with small bonuses for Fake Out, Intimidate, Tailwind,
  Trick Room, redirection and Helping Hand), why each was picked, and which of their Pokémon your group still can't answer.
  Only one Pokémon can Mega Evolve per battle, so each of your Mega Stone holders is judged both ways and a group is
  scored with the best choice of which one evolves (the others play as their base form, tagged **NO MEGA**).
  **Move to front** reorders your team to match and selects the leads. It assumes full HP and no field effects and doesn't
  model switching, Protect or status moves, so treat it as a starting point. Logic lives in `src/lib/bring.ts`
  (`npx tsx scripts/bring-test.mjs` checks it).
- **Best move** (mid-battle): set each Pokémon's HP, boosts and status in its editor and the field in the Field panel, then
  press **Best move**. In **Singles** it simulates the 1v1 for up to 5 turns, assuming the opponent uses whichever of
  their damaging moves is worst for you, and ranks your moves by your chance to win, with the chance to KO right now, by
  turn 2 and by turn 3. It accounts for accuracy, current HP, boosts, speed and priority, Disguise, recharge and
  two-turn moves, and stat drops from moves like Draco Meteor. In **Doubles** it ranks combined plans for your two active
  Pokémon this turn by KO chance and damage (focus fire, spread-move reduction and friendly fire from Earthquake-style
  moves included), and shows what each opposing Pokémon can do to yours. Status moves, Fake Out and similar situational
  moves are listed but not scored; switching, Protect, Focus Sash and residual damage are not modeled. Logic lives in
  `src/lib/recommend.ts` (`npx tsx scripts/recommend-test.mjs` checks it).
- **Look up**: the header's **Look up** button opens a searchable reference of every Champions move, item and ability with
  Smogon's descriptions. Search by name *or by what it does* ("lowers speed", "1.5x", "flinch"), filter moves by type and
  category, and press **Use: You / Use: Opp** to give one to that side's selected Pokémon (a Mega Stone switches it to
  its Mega form; an ability must be one that Pokémon can have; a move goes in the first empty slot).
- **op.gg usage panel** for the active Pokémon (moves, items, abilities, natures, spreads), for Singles or Doubles.
  Pick which move slot a clicked move fills.
- **Presets**: save custom builds per Pokémon (shared across its Mega and other forms), with rename, update, delete,
  clear-all and export/import.
- **Field and battle state**: weather, terrain, Gravity, Trick Room, screens, hazards, Tailwind, Fairy Aura, Salt Cure,
  Leech Seed, Curse, binding, Ingrain, Aqua Ring, Charge, Steely Spirit, stat boosts, status, HP (bar, value or
  percent), "Ability active" and Supreme Overlord. **Reset battle** clears all of it. In the Field panel the common
  effects (Reflect, Light Screen, Stealth Rock, Helping Hand) are one-click chips; everything else is added from each
  side's **+ Add effect** menu and shows as a removable tag while it is on.
- **Doubles on-field pair**: click a Pokémon to select it, and press **＋** on another slot to put it on the field as the
  second one (the selected Pokémon is always on the field). Spread moves only lose their ×0.75 when they would hit more
  than one Pokémon, so with a single Pokémon on a side they are not reduced. Earthquake-style moves also count your own
  partner. Click the second Pokémon (or press its number) to swap the pair. With two Pokémon on a side, the damage
  panels switch to a grid showing every selected attacker's damaging moves against every selected foe.
- **Mega toggle**: click the Mega Stone to switch between the base and Mega form.
- **Type matchups**: hover (or focus) a Pokémon's type badges to see everything it is weak to, resists or is immune to,
  grouped by multiplier (4×, 2×, ½×, ¼×, 0×). Type chart only; abilities and items aren't included.
- A **Smogon** link per Pokémon, a tab title that follows the matchup, and a stale-data indicator.

Your teams, presets, saved teams and field settings are stored in your browser's local storage. Clearing site data
removes them, so use the export buttons for anything you want to keep.

## Where the data comes from

`public/data/champions.json` is generated by `scripts/scrape.mjs`. op.gg renders its pages on the server and embeds
the data in the HTML, so the scraper reads that embedded data directly (about 260 pages, a minute or so). The file holds
usage rates, ranks and each form's abilities. `public/data/smogon.json` is generated by `scripts/smogon.mjs` from
Smogon's Champions dex: move stats, plus each ability, item and move's full description (one small request per entry, about
900 in all, taking only seconds). If the Smogon step fails, the op.gg data
is still saved. Sprites come from Pokémon Showdown.

### The Refresh button

A browser cannot fetch op.gg directly (cross-origin rules), so the button asks a small endpoint on the local server
(`/api/refresh`, defined in `vite.config.ts`) to run the scraper.

- Under `npm run dev` or `npm run preview`: **Refresh op.gg data** scrapes op.gg and reloads the app.
  It turns amber after 30 minutes, since op.gg updates every 30 minutes.
- On a hosted copy (no scraper): the button becomes **Reload data** and fetches the data file published with the site.
  It only turns amber after 12 hours (two missed rebuilds).

## Deploying to GitHub Pages

The repo includes `.github/workflows/deploy.yml`, which builds the site and publishes it, and rebuilds every 6 hours
with fresh op.gg data.

1. Push the project to a GitHub repository whose default branch is `main`.
2. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow from the **Actions** tab). The site appears at
   `https://<your-name>.github.io/<repo>/`.

Notes:

- `vite.config.ts` uses a relative base path, so it works at any repository name.
- Commit `public/data/champions.json`. If a scheduled scrape fails (op.gg down, or its page format changed), the
  workflow keeps the last committed data and still deploys.
- Scheduled workflows are paused by GitHub after 60 days without repository activity in public repos. Re-enable them
  from the **Actions** tab.
- Each scheduled run downloads roughly 260 pages from op.gg. Keep the schedule modest, and check op.gg's terms before
  publishing a site that scrapes it automatically.

## Project layout

```
src/
  App.tsx                 page layout, saved state, keyboard shortcuts, tab title
  components/             team panels, editor, results, turn order, field, presets, saved teams
  lib/
    calc.ts               damage calculation, field and side effects, spread-move handling
    vendor/kochance.js    generated KO-chance code (see below)
    model.ts              sets, Stat Points, the Champions ruleset
    speed.ts              turn order and priority
    showdown.ts           paste import/export, Pokepaste sharing
    data.ts               loads op.gg data, builds sets from usage
    presets.ts, teams.ts  saved presets and teams (localStorage)
scripts/
  scrape.mjs              op.gg scraper (also used by the Refresh endpoint)
  gen-kochance.mjs        regenerates src/lib/vendor/kochance.js
  *-test.mjs              developer checks, run with `npx tsx scripts/<name>.mjs`
public/data/champions.json  scraped data
```

### The generated KO-chance file

`@smogon/calc` keeps its end-of-turn math private, so it can't be extended from outside. `src/lib/vendor/kochance.js`
is a generated copy of that code (MIT licensed) with hooks for effects the library lacks (Ingrain, Aqua Ring, Curse,
binding, Mimikyu's Disguise) and a fix so Gravity and Iron Ball ground Pokémon for Spikes. **After upgrading `@smogon/calc`, run
`node scripts/gen-kochance.mjs`** to regenerate it, then re-run the checks in `scripts/`.

## Known limits

- Quick Claw, Custap Berry and abilities that react mid-turn are not modeled in turn order.
- Mimikyu's Disguise is handled (an intact Mimikyu takes one extra hit and loses 1/8 HP; pick Mimikyu-Busted to see the
  broken form). Other "survive the first hit" effects (Sturdy, Focus Sash) are not modeled in the KO text.
- The negative-priority moves in `src/lib/speed.ts` (Trick Room, Dragon Tail, Counter and similar) are entered by hand
  because the calc's move data only lists positive priority. `scripts/reference-test.mjs` checks them against Smogon's data.
- Mega usage on op.gg is recorded on the base Pokémon's page, so a Mega's usage numbers are approximate.
- The scraper depends on op.gg's page format. If op.gg redesigns the site, the scraper (and Refresh) will need updating;
  the data already on disk keeps working.

## Credits

Damage math by [`@smogon/calc`](https://github.com/smogon/damage-calc) (MIT). Usage data from
[op.gg](https://op.gg/pokemon-champions/tier). Move, item and ability descriptions from the
[Smogon Pokémon Champions dex](https://www.smogon.com/dex/champions/pokemon/). Sprites from [Pokémon Showdown](https://play.pokemonshowdown.com).
This is an unofficial fan project and is not affiliated with Nintendo, Game Freak, The Pokémon Company, Smogon or op.gg.
Pokémon and related names are trademarks of their owners.
