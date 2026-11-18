import { MODULE } from '../util/constants.js';

export const PRESET_FLAG = 'monsterPresets';
export const ACTIVE_PRESET_FLAG = 'activeMonsterPreset';
export const PRESET_UPDATE_OPTION = 'wttrpgMonsterPreset';
export const DEFAULT_MONSTER_PRESET_ID = 'default';
export const PLACEMENT_FLAG = 'monsterPresetOnPlacement';
export const RANDOM_PRESET = 'random';

const presetPath = `flags.${MODULE.ID}.${PRESET_FLAG}`;
const activePresetPath = `flags.${MODULE.ID}.${ACTIVE_PRESET_FLAG}`;

const PRESET_SYSTEM_FIELDS = [
    'stats', 'derivedStats', 'skills', 'skillGroupModifiers', 'currency', 'attackStats',
    'focus1', 'focus2', 'focus3', 'focus4', 'damageTypeModification',
    'customStat', 'addMeleeBonus', 'dontAddAttr', 'regeneration',
    'armorHead', 'armorUpper', 'armorLower', 'armorTailWing', 'hasTailWing',
    'resistantNonSilver', 'resistantNonMeteorite', 'statusEffectImmunities', 'resistances',
    'immunities', 'susceptibilities', 'senses'
];
const DERIVED_RESOURCES = ['hp', 'sta', 'resolve', 'focus', 'shield'];

export function getMonsterPresets(actor) {
    const presets = actor?.getFlag(MODULE.ID, PRESET_FLAG);
    return Array.isArray(presets) ? presets : [];
}

export function captureMonsterPreset(actor) {
    const { system, items } = actor.toObject();
    return {
        system: Object.fromEntries(PRESET_SYSTEM_FIELDS.map(key => [key, system[key]])),
        items,
        actorUuid: actor.uuid
    };
}

export function getActiveMonsterPresetId(actor) {
    return actor.getFlag(MODULE.ID, ACTIVE_PRESET_FLAG) ?? DEFAULT_MONSTER_PRESET_ID;
}

export function canEditMonsterPresets(actor) {
    return actor?.isOwner && (!actor.pack || game.packs.get(actor.pack)?.locked === false);
}

export async function initializeMonsterPresets(actor, defaultName) {
    const presets = getMonsterPresets(actor);
    if (presets.some(preset => preset.id === DEFAULT_MONSTER_PRESET_ID)) return true;
    const defaultPreset = {
        id: DEFAULT_MONSTER_PRESET_ID, name: defaultName, images: [], ...captureMonsterPreset(actor)
    };
    return saveMonsterPresets(actor, [defaultPreset, ...presets]);
}

export async function saveMonsterPresets(actor, presets, activeId) {
    if (!canEditMonsterPresets(actor)) return false;
    const update = { [presetPath]: presets };
    if (activeId) update[activePresetPath] = activeId;
    return Boolean(await actor.update(update));
}

export async function getWildcardImages(actor) {
    return actor.prototypeToken.randomImg ? [...new Set(await actor.getTokenImages())] : [];
}

function getResources(system) {
    return [system.stats.luck, ...DERIVED_RESOURCES.map(key => system.derivedStats[key])];
}

export function hasSpentResources(actor) {
    return getResources(actor.system).some(({ value, max }) => value < max);
}

function getPresetItems(preset, actorUuid, baseActor) {
    const items = foundry.utils.deepClone(preset.items);
    const sourceUuids = new Set([preset.actorUuid, baseActor.uuid]);
    if (baseActor._stats?.compendiumSource) sourceUuids.add(baseActor._stats.compendiumSource);
    // Embedded item IDs stay stable. Owned weapon skills and bonuses store their parent as a UUID.
    for (const item of items) {
        for (const key of ['parentWeaponUuid', 'parentItemUuid']) {
            const uuid = item.system?.[key];
            if (typeof uuid !== 'string') continue;
            const suffix = uuid.lastIndexOf('.Item.');
            if (suffix < 0 || !sourceUuids.has(uuid.slice(0, suffix))) continue;
            item.system[key] = `${actorUuid}${uuid.slice(suffix)}`;
        }
    }
    return items;
}

async function protectTokenPresets(actor, incomingItems, incomingModifiers) {
    for (const token of actor.getDependentTokens({ concreteOnly: true })) {
        if (token.actorLink || !token.getFlag(MODULE.ID, ACTIVE_PRESET_FLAG)) continue;
        if (!token.canUserModify(game.user, 'update')) continue;
        const delta = token.toObject().delta;
        const existingIds = new Set(delta?.items?.map(item => item._id));
        const tombstones = incomingItems.filter(item => !existingIds.has(item._id)).map(item => ({
            _id: item._id, _tombstone: true
        }));
        const modifiers = Object.fromEntries(Object.entries(incomingModifiers)
            .filter(([id]) => !Object.hasOwn(delta?.system?.skillGroupModifiers ?? {}, id))
            .map(([id, modifier]) => [id, { ...modifier, value: 0 }]));
        const changes = {};
        if (tombstones.length) changes.items = tombstones;
        if (Object.keys(modifiers).length) changes.system = { skillGroupModifiers: modifiers };
        if (Object.keys(changes).length && !await token.update({ delta: changes })) return false;
    }
    return true;
}

export async function switchActorMonsterPreset(actor, presetId) {
    if (actor.type !== 'monster' || actor.isToken || !canEditMonsterPresets(actor)) return false;
    const activeId = getActiveMonsterPresetId(actor);
    if (activeId === presetId) return true;
    const presets = getMonsterPresets(actor);
    const preset = presets.find(entry => entry.id === presetId);
    if (!preset) return false;

    const items = getPresetItems(preset, actor.uuid, actor);
    if (!actor.pack && !await protectTokenPresets(actor, items, preset.system.skillGroupModifiers ?? {})) return false;
    if (getActiveMonsterPresetId(actor) !== activeId || getMonsterPresets(actor) !== presets) return false;

    const current = captureMonsterPreset(actor);
    const replacement = foundry.data.operators.ForcedReplacement;
    const system = Object.fromEntries(Object.entries(preset.system)
        .map(([key, value]) => [key, replacement.create(value)]));
    return Boolean(await actor.update({
        system,
        items: replacement.create(items),
        [presetPath]: presets.map(entry => entry.id === activeId ? { ...entry, ...current } : entry),
        [activePresetPath]: preset.id
    }));
}

function fillResources(token, system, items) {
    const source = token.actor.toObject();
    Object.assign(source.system, foundry.utils.deepClone(system));
    source.items = foundry.utils.deepClone(items);
    // Evaluate derived maxima in a healthy state using the system's normal stat preparation.
    source.system.derivedStats.hp.value = Number.MAX_SAFE_INTEGER;
    class PresetPreview extends CONFIG.Actor.documentClass {
        applyStatus() {} // Equipped armor can add status effects to a live actor during preparation.
        getDependentTokens() { return []; }
    }
    const preview = new PresetPreview(source, { parent: token });
    const prepared = getResources(preview.system);
    getResources(system).forEach((resource, index) => {
        resource.value = Math.max(0, prepared[index].max);
    });
    system.deathSaves = 0;
}

export function canApplyMonsterPreset(token) {
    return token?.baseActor?.type === 'monster' && token.actor?.isOwner
        && token.canUserModify(game.user, 'update');
}

export function prepareMonsterTokenPreset(token, preset, tokenId = token.id) {
    const baseActor = token.baseActor;
    const source = token.toObject();
    const delta = token.actorLink ? {} : (source.delta ?? {});
    delta._id = tokenId;
    const actorUuid = `${token.parent.uuid}.Token.${tokenId}.Actor.${baseActor.id}`;
    const items = getPresetItems(preset, actorUuid, baseActor);
    const system = foundry.utils.deepClone(preset.system);
    // ActorDelta merges keyed objects with the base. Mask base-only skill modifiers with zero.
    for (const [id, modifier] of Object.entries(baseActor.system.skillGroupModifiers)) {
        system.skillGroupModifiers[id] ??= { ...modifier, value: 0 };
    }
    fillResources(token, system, items);
    const itemIds = new Set(items.map(item => item._id));
    delta.items = [...items, ...baseActor.items.filter(item => !itemIds.has(item.id)).map(item => ({
        _id: item.id,
        _tombstone: true
    }))];
    delta.system = { ...delta.system, ...system };

    return {
        delta: foundry.data.operators.ForcedReplacement.create(delta),
        [activePresetPath]: preset.id
    };
}

export async function applyMonsterPreset(token, preset, image) {
    if (!canApplyMonsterPreset(token)) return false;
    const wasLinked = token.actorLink;
    const update = prepareMonsterTokenPreset(token, preset);
    if (image) update['texture.src'] = image;

    // A linked token needs a synthetic ActorDelta before Foundry will commit new embedded items to it.
    if (wasLinked && !await token.update({ actorLink: false })) return false;
    let applied = false;
    try {
        // Replace the delta in one write so items from the previous preset cannot leak into this one.
        applied = Boolean(await token.update(update, { [PRESET_UPDATE_OPTION]: true }));
        return applied;
    } finally {
        if (wasLinked && !applied) await token.update({ actorLink: true });
    }
}
