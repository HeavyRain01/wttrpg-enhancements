# WTTRPG Enhancements

**WTTRPG Enhancements** adds flexible combat tools to *The Witcher TRPG* system for Foundry VTT. It helps GMs create ongoing effects, special weapon techniques, lifesteal, conditional and situational bonuses, and more controlled damage application while keeping the system's normal combat flow.

## What the module adds

### Valuable journal attachments

Valuable item sheets include an **Attached journal** field. Drop a journal entry or a specific journal page into it to attach or replace the link; use the unlink button to remove it. Attachments appear beneath the item name in character inventories and in new **Send to chat** cards. Links use Foundry's normal journal permissions and do not grant access to the journal. The module injects this field without replacing system templates.

### Valuable item uses

On a General Valuable's item sheet, open **WTTRPG Enhancements: Item Uses** from the header menu. The GM can add, edit, or remove uses in the card grid. Each use can have an icon, a rich description, and an optional condition. Owners can open the action cards from **Use** on the item sheet or the lightning icon on its inventory row. The info button on each card opens its description. Using an item does not change its quantity.

Conditions use the same expressions and autocomplete as other enhancements. `actor` is the actor carrying the item, `target` is the first targeted actor, and `source` is the Valuable. For example, `hp() < maxHp()` makes a use available to an actor below full HP. The picker can show unavailable uses for reference, and the condition is checked again when the user confirms the action.

- **Run Macro:** Paste an inline script or drop an existing Macro. **GM** is the default; a player using this option needs an active GM. **Player using the item** runs locally under the user's normal Foundry macro permissions. Scripts receive `item`, `actor`, `token`, `speaker`, and `user` (the user who clicked Use). For remote execution, `game.user` and the canvas are the GM's; use the passed context for the item and actor. If you copy an item or change a linked macro's code, review and save the use on the relevant item before running it with GM privileges. For linked macros run by the GM, connect the GM client over HTTPS or localhost so it can verify the approved script. Inline scripts are stored on the item and are visible to item owners.
- **Draw from Roll Table:** Drop a Roll Table. The draw uses Foundry's normal table permissions and posts the result to chat. For a player without edit access, use a table that draws with replacement.
- **Apply Active Effects:** Add effects in the item's normal configuration and mark them **Apply on Self** or **Apply on Target**. A use applies the effects with the matching option to the actor carrying the item or to the user's targeted tokens. Existing On Damage uses can be edited or removed in the manager.
- **Skill Check:** Select a standard skill or a profession skill to roll the Witcher system's normal check with the actor carrying the item. For items outside an actor's inventory, enter the profession skill name as it appears on the intended actor's profession sheet.

### Ongoing damage and healing

Active Effects can deal damage or restore health automatically when a character's turn begins.

- Create poison, bleeding, burning, regeneration, and similar effects.
- Choose the roll formula, damage type, hit location, and armor-related properties.
- Apply damage automatically or leave it as a chat roll for the GM to resolve.
- Show clear chat cards for every damage or healing tick.

**Example:** A poison effect deals `2d6` damage to the torso at the start of each affected character's turn, while a regeneration potion restores `1d6` HP per turn.

### Lifesteal and overheal

Weapons, spells, weapon skills, and damaging ongoing effects can return part of the damage they deal to the attacker.

- Restore HP, Stamina, or the same attribute that was damaged.
- Limit how much can be stolen by a single attack; set the limit to `0` for no cap.
- Turn excess HP recovery into a shield.
- Set a maximum shield value.
- Add conditions so lifesteal only works in specific situations.

**Example:** A vampiric sword restores 25% of the HP damage it deals. If its wielder is already at full HP, half of that excess healing becomes a shield, up to a chosen limit.

### Conditional damage bonuses

Active Effects can increase an attacker's damage for one damage type or for all damage.

- Add extra dice or a flat bonus to a damage roll.
- Multiply the final damage.
- Limit the bonus with conditions based on the attacker, target, or damage dealt.
- Apply the same bonuses to ongoing damage where appropriate.

**Example:** A monster-hunting oil adds `1d6` damage against monsters, while a vulnerability effect doubles slashing damage.

#### Condition expressions

Conditions can use `actor` (an alias for `attacker`), `attacker`, `target`, `damage`, `source`, and `professionTree`, including their full property paths. `source` is the Item that produced the attack, so a weapon skill remains distinguishable from its parent weapon. `professionTree` is the attacker's profession system data. The expression parser supports comparisons, arithmetic, `&&`, `||`, `!`, and parentheses.

Common values have shorter helper functions:

- `hp()`, `sta()`, `shield()`, `focus()`, `resolve()`, `vigor()`, `luck()`, and `toxicity()` return the attacker's current value. Pass an actor to read another actor, such as `hp(target)`.
- The matching maximum helpers are `maxHp()`, `maxSta()`, `maxShield()`, `maxFocus()`, `maxResolve()`, `maxVigor()`, `maxLuck()`, and `maxToxicity()`.
- `attribute('name', actor?)` and `maxAttribute('name', actor?)` read any derived stat or regular stat. `stat('ref', actor?)` is a shortcut for a regular stat.
- `skillLevel('name', actor?)` returns the level of a standard or custom skill, or `0` when the skill is absent. Standard skills can be identified by internal key, name, or localized label; for example, `skillLevel('Athletics') >= 6` or `skillLevel('Swordsmanship', target) < 5`.
- `hasActiveEffect('name', actor?)` checks for a non-disabled, non-suppressed Active Effect by name. `getActiveEffect('name', actor?)` returns that effect so its data can be used in an expression.
- `armor(location?, actor?)` returns total stopping power. It defaults to the current target and damage location; for example, `armor('head')` or `armor('torso', attacker)`.
- `isSourceAWeaponSkill(name?)` and `isSourceAWeapon(name?)` check the attack source, optionally matching its name without regard to case.
- `professionTree(actor?)` returns the complete profession system data. `professionSkill('name', actor?)` returns a profession ability so any of its properties can be inspected.
- `professionSkillRank('name', actor?)` returns an ability's rank, or `0` if it is absent. `hasProfessionSkill('name', minimumRank?, actor?)` checks that it has been raised to at least the requested rank (rank `1` by default).
- `professionSkillPoints(actor?)` returns the total points invested in the defining skill and all nine profession path skills.

Examples:

```text
hp(target) < maxHp(target) / 2
stat('ref') > 5 && hasActiveEffect('Monster Oil')
getActiveEffect('Blood Frenzy').system.changes[0].value * 2 > damage.amount
armor() < 10 && damage.type === 'slashing'
isSourceAWeaponSkill('Whirl') && professionSkillRank('Fury') >= 5
professionSkillPoints() >= 20
isSourceAWeapon() && professionSkill('Tactical Awareness').thresholds.hasThresholds
skillLevel('Athletics') >= 6 && skillLevel('My Custom Skill') > 0
```

Condition fields on amplifier, lifesteal, weapon-skill, and situational-bonus sheets offer context-aware autocomplete while typing. Use the arrow keys to move through suggestions, `Enter` or `Tab` to insert one, and `Escape` to close the list.

### Situational bonuses

Actors can carry optional bonuses which a player selects when making a roll. Each situational bonus has a title, description, image, roll formula, and optional availability condition. Its scope determines where it appears:

- **Skill Check** adds its formula to standard, custom, or profession skill checks. It can apply to every skill or only selected skills.
- **Attack** adds its formula to a weapon or spell attack roll.
- **Damage** adds its formula to weapon or spell damage. Damage bonuses are also available in the enhanced Apply Damage dialog.
- **Defense** adds its formula to a defense roll. Select the applicable defense types, such as Block or Dodge, or leave them all unchecked to allow every defense. The bonus picker opens after you choose your defense and any shield or weapon it uses.

Bonuses attached directly to an actor are global and can apply whenever their scope and condition match. Weapon and spell bonuses apply when using those items, and weapon skills recognize attack and damage bonuses attached to their parent weapon. Carried armor and valuables can grant Defense bonuses while outside a container. For other scopes, armor must also be equipped. A shield's Defense bonuses require choosing that particular shield.

The roll dialog clearly labels every available bonus with:

- Its scope, such as **Defense**.
- Its origin, shown as **Actor (Global)** or the name of its item.
- Its formula, title, description, and artwork.

Each bonus has a configurable roll-card image layout:

- **Image on Left** displays a dedicated image panel on the left.
- **Image on Right** mirrors the panel to the right.
- **Full Card Cover** stretches the image across the card beneath a readability gradient.

Create a global bonus in the actor's **Situational Bonuses** manager. To attach a bonus to a weapon, spell, armor, shield, or valuable, open **WTTRPG Enhancements** from the item's sheet header. You can also drag in a reusable situational-bonus item. Attached bonuses copy with their parent item when it is added to an actor.

Conditions use the same safe expression engine and autocomplete as other enhancements. They can inspect the acting actor, current target, attack source, damage context, resources, Active Effects, ordinary skills, and profession abilities.

**Examples:**

- *Higher Ground* adds `+2` to attacks while its condition is true.
- *Specialized Training* adds `1d6` only to selected skill checks when `skillLevel('Athletics') >= 6`.
- *Silver Edge* is attached to one sword and adds `1d6` damage only when that sword attacks.
- *Focused Sign* is attached to one spell and improves only that spell's attack roll.
- *Shield Brace* is attached to one shield, applies to Block, and uses the condition `sta() >= 5`. The card appears when the defender chooses that shield and has at least 5 Stamina.

For Defense bonuses, `actor`, `target`, and helpers such as `sta()` refer to the defender. `attacker` is the opposing actor and `source` is the incoming attack item. A global Defense bonus can check the equipment directly with `defense.type === 'block' && defense.item.name === 'Kite Shield'`. An armor bonus can require the armor to be equipped with `item.system.equipped`, where `item` is the item providing the bonus.

### More control when applying damage

An enhanced **Apply Damage** option is available from damage messages in chat.

- Adjust the rolled amount by a fixed number or percentage before applying it.
- Choose the hit location.
- Add temporary stopping power to that location for this damage application without changing the actor's armor.
- Mark the damage as non-lethal.
- Account for vulnerability, weapon oils, and monster resistances.
- Trigger any lifesteal attached to the attack.

**Example:** The GM can reduce an incoming hit by 50% for a special resistance, move it to the arm, add a small flat bonus, or grant temporary stopping power without editing the original roll or armor.

### Weapon skills and special attacks

A weapon can have several alternate techniques attached to it. Whenever that weapon attacks, the player can use its normal attack or choose one of those techniques.

Each weapon skill can have its own:

- Damage formula and damage types.
- Melee or ranged attack mode.
- Attack skill and roll modifier.
- Stamina cost and number of attacks.
- Allowed strike types and target locations.
- Range, ammunition use, and damage properties.
- Defense options available to the target.
- Lifesteal and Active Effects.
- An availability condition based on the attacking actor and current target.

Skills can be created directly on a weapon or copied from reusable templates. An attached copy can inherit the weapon's properties or keep the template's own values.

The attack picker shows the weapon's normal attack alongside its skills. Skill conditions use `actor` (the weapon's owner) and `target` (the first currently targeted actor). Skills whose conditions are not met are hidden by default. The player can show and use every attached skill for the current attack with the Show all skills option; if no skill is available, the standard weapon attack is selected automatically.

**Example:** A *Pommel Strike* may cost 3 Stamina, deal bludgeoning damage, use a different attack skill, and allow the defender an additional defense option. A *Whirl* technique may make a fixed number of attacks with its own accuracy penalty.

### Campaign Codex Timeline Widget

Campaign Timeline has moved to a standalone module. Enable it in your world to continue using timelines stored on existing Campaign Codex journals. [Campaign Codex Timeline Widget](https://github.com/HeavyRain01/foundry-campaign-codex-timeline)

### Optional Argon Combat HUD integration

[Enhanced Combat HUD for The Witcher TRPG](https://github.com/pedroaugustobt/enhancedcombathud-thewitchertrpg) is supported as a soft dependency. WTTRPG Enhancements continues to work normally when it is not installed.

When the Argon core and Witcher integration modules are active:

- Available attached weapon skills appear as direct action buttons around their weapon, using the same actor-and-target condition checks as the attack picker. The first three occupy the lower edge, the next three occupy the upper edge, and additional rows grow upward.
- Left-clicking a skill performs that skill's attack directly. Right-clicking opens its item sheet.
- Monsters without equipped weapons still receive HUD buttons for all of their non-ammunition weapons. Player characters continue to use Argon's equipped-weapon behavior.
- Client settings can independently hide Brawling actions, Verbal Combat, and Special Attacks from the HUD.

## Monster presets

Open **Monster Presets** from an owned world Monster sheet’s header menu. The first time you open it, **Default preset** captures the current stats, skills, and inventory. Use **Save Current Sheet as Preset** to create a variation from the current sheet and make the copy active. Edit the sheet, then use **Switch** to save your edits and load another preset, including Default. You can rename any preset, assign artwork, or save the current sheet to a preset immediately with **Replace from Current Sheet**. Linked tokens follow the world actor’s active setup.

A token’s Monster sheet can also save its current setup to the base actor’s preset list.

In the world Monster’s **Monster Presets** window, use **Preset on placement** to choose **Random preset**, a specific saved preset, or **Use current actor setup**. A token placed with a preset starts unlinked and at full resources. If the preset has valid wildcard images assigned, Foundry picks one of those images on placement.

Right-click a Monster token on the scene and use **Switch Monster Preset** in its Token HUD. Applying a preset refills the token’s resources to the new maxima. A linked token becomes unlinked when you apply a preset so its changes stay local to that token. If the actor’s prototype token uses wildcard artwork, assign one or more matching images to each preset and choose among them when switching.

## Where to find the features

The GM can open **WTTRPG Enhancements** from the header of:

- An **Active Effect** to configure ongoing damage, ongoing healing, lifesteal, or damage amplification.
- A **weapon or spell** to configure lifesteal.
- A **weapon** to create, attach, and manage weapon skills.
- An owned **actor** to create, attach, and manage global situational bonuses.
- A **weapon or spell** to create, attach, and manage item-specific Attack and Damage bonuses.

The actor-sheet header uses the standard WTTRPG Enhancements icon to open its situational-bonus manager. Damage messages gain an enhanced **Apply Damage** entry in their context menu. Timed effects are processed by the GM during combat.

## Requirements

- Foundry VTT 14
- *The Witcher TRPG* system 14.2.1 or newer
- [libWrapper](https://foundryvtt.com/packages/lib-wrapper)

Optional:

- [Argon - Combat HUD](https://foundryvtt.com/packages/enhancedcombathud) with [Enhanced Combat HUD for The Witcher TRPG](https://github.com/pedroaugustobt/enhancedcombathud-thewitchertrpg)
