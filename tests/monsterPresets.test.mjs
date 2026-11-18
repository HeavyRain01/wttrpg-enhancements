import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    ACTIVE_PRESET_FLAG, PRESET_FLAG, switchActorMonsterPreset
} from '../src/lib/data/monsterPresets.js';

class Replacement {
    static create(value) { return new this(value); }
    constructor(value) { this.value = value; }
}

beforeEach(() => {
    globalThis.foundry = {
        utils: { deepClone: structuredClone },
        data: { operators: { ForcedReplacement: Replacement } }
    };
});

function monster() {
    const source = {
        system: { stats: { body: { value: 5 } } },
        items: [
            { _id: 'dagger', name: 'Dagger', system: {} },
            { _id: 'coins', name: 'Coins', system: { quantity: 12 } }
        ]
    };
    const flags = {
        [ACTIVE_PRESET_FLAG]: 'knife',
        [PRESET_FLAG]: [
            { id: 'knife', system: {}, items: [] },
            {
                id: 'spear', actorUuid: 'Actor.original',
                system: { stats: { body: { value: 7 } } },
                items: [
                    { _id: 'spear', name: 'Spear', system: {} },
                    { _id: 'skill', name: 'Thrust', system: { parentWeaponUuid: 'Actor.original.Item.spear' } },
                    { _id: 'coins', name: 'Coins', system: { quantity: 20 } }
                ]
            },
            { id: 'empty', system: {}, items: [] }
        ]
    };
    return {
        type: 'monster', isOwner: true, uuid: 'Actor.monster',
        getFlag(_scope, key) { return flags[key]; },
        getDependentTokens() { return []; },
        toObject() { return structuredClone(source); },
        async deleteEmbeddedDocuments(_type, ids) {
            source.items = source.items.filter(item => !ids.includes(item._id));
        },
        async createEmbeddedDocuments(_type, items, options) {
            assert.equal(options.keepId, true);
            source.items.push(...structuredClone(items));
        },
        async update(changes) {
            // Reproduce the failure where a parent Actor update merges the requested inventory.
            const items = new Map(source.items.map(item => [item._id, item]));
            for (const item of changes.items.value) items.set(item._id, item);
            source.items = [...items.values()];
            for (const [key, value] of Object.entries(changes.system)) source.system[key] = value.value;
            flags[PRESET_FLAG] = changes['flags.wttrpg-enhancements.monsterPresets'];
            flags[ACTIVE_PRESET_FLAG] = changes['flags.wttrpg-enhancements.activeMonsterPreset'];
            return this;
        }
    };
}

test('world actor switches remove previous equipment and save each outgoing inventory before deleting it', async () => {
    const actor = monster();
    const original = actor.toObject();
    assert.equal(await switchActorMonsterPreset(actor, 'spear'), true);
    assert.deepEqual(actor.toObject().items.map(item => item._id).sort(), ['coins', 'skill', 'spear']);
    assert.equal(actor.toObject().items.find(item => item._id === 'skill').system.parentWeaponUuid, 'Actor.monster.Item.spear');
    assert.equal(actor.toObject().system.stats.body.value, 7);
    assert.deepEqual(actor.getFlag('', PRESET_FLAG).find(preset => preset.id === 'knife').items, original.items);
    assert.equal(await switchActorMonsterPreset(actor, 'knife'), true);
    assert.deepEqual(actor.toObject().items.sort((a, b) => a._id.localeCompare(b._id)),
        original.items.sort((a, b) => a._id.localeCompare(b._id)));
    assert.deepEqual(actor.toObject().system.stats, original.system.stats);
    assert.equal(await switchActorMonsterPreset(actor, 'empty'), true);
    assert.deepEqual(actor.toObject().items, []);
});

test('a rejected or failed actor update restores deleted equipment and preserves preset flags', async () => {
    for (const throws of [false, true]) {
        const actor = monster();
        const original = actor.toObject();
        const presets = structuredClone(actor.getFlag('', PRESET_FLAG));
        actor.update = async () => {
            if (throws) throw new Error('Update failed');
            return undefined;
        };
        if (throws) await assert.rejects(switchActorMonsterPreset(actor, 'spear'), /Update failed/);
        else assert.equal(await switchActorMonsterPreset(actor, 'spear'), false);
        assert.deepEqual(actor.toObject().items.sort((a, b) => a._id.localeCompare(b._id)),
            original.items.sort((a, b) => a._id.localeCompare(b._id)));
        assert.deepEqual(actor.getFlag('', PRESET_FLAG), presets);
        assert.equal(actor.getFlag('', ACTIVE_PRESET_FLAG), 'knife');
    }
});

test('a partially cancelled item deletion aborts the switch and restores removed items', async () => {
    const actor = monster();
    await actor.createEmbeddedDocuments('Item', [{ _id: 'shield', name: 'Shield', system: {} }], { keepId: true });
    const original = actor.toObject();
    const deleteItems = actor.deleteEmbeddedDocuments.bind(actor);
    actor.deleteEmbeddedDocuments = async (type, ids) => deleteItems(type, ids.slice(0, 1));
    actor.update = async () => assert.fail('A cancelled deletion must stop the actor update');
    assert.equal(await switchActorMonsterPreset(actor, 'spear'), false);
    assert.equal(actor.getFlag('', ACTIVE_PRESET_FLAG), 'knife');
    assert.deepEqual(actor.toObject().items.sort((a, b) => a._id.localeCompare(b._id)),
        original.items.sort((a, b) => a._id.localeCompare(b._id)));
});

test('overlapping switches on the same actor cannot capture an intermediate inventory', async () => {
    const actor = monster();
    const update = actor.update.bind(actor);
    let finish;
    actor.update = async changes => {
        await new Promise(resolve => { finish = resolve; });
        return update(changes);
    };
    const pending = switchActorMonsterPreset(actor, 'spear');
    // Wait for the first switch to reach its final actor update.
    while (!finish) await Promise.resolve();
    assert.equal(await switchActorMonsterPreset(actor, 'empty'), false);
    finish();
    assert.equal(await pending, true);
    actor.update = update;
    assert.equal(await switchActorMonsterPreset(actor, 'empty'), true);
});
