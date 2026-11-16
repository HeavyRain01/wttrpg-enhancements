import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getValuableUses, handleValuableMacroQuery, isValuableUseAvailable, runValuableUse, saveValuableUse } from '../src/lib/util/valuableUse.js';

const appApi = {
    ApplicationV2: class {
        async _prepareContext() { return {}; }
        async render() {
            return this._prepareContext({});
        }
    },
    HandlebarsApplicationMixin: Base => Base
};
globalThis.foundry = { applications: { api: appApi } };

const { addValuableUseManager, applyValuableUseEffects } = await import('../src/lib/integrations/valuableUse.js');

const player = { id: 'player', active: true, can: () => true };
const gm = { id: 'gm', active: true, isGM: true, can: () => true };
const other = { id: 'other', active: true };
const users = new Map([player, gm, other].map(user => [user.id, user]));
const inline = { name: 'Activate', type: 'macro', source: 'inline', command: 'return 1;' };
let documents, approvals, executions, nextId;

function valuable(uuid = 'Actor.actor.Item.item') {
    const item = {
        documentName: 'Item', uuid, type: 'valuable', system: { type: 'general' }, isOwner: true, flags: [],
        actor: { uuid: 'Actor.actor', isOwner: true, getActiveTokens: () => [] },
        getFlag() { return this.flags; },
        async setFlag(_scope, _key, value) { this.flags = value; },
        testUserPermission: user => user === gm || user === player
    };
    documents.set(uuid, item);
    return item;
}

beforeEach(() => {
    documents = new Map(); approvals = {}; executions = []; nextId = 0;
    globalThis.game = {
        user: gm, users, i18n: { localize: key => key },
        settings: { get: () => approvals, async set(_scope, _key, value) { approvals = value; } }
    };
    globalThis.fromUuid = async uuid => documents.get(uuid);
    globalThis.foundry = { utils: { randomID: () => String(++nextId), cleanHTML: String } };
    globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
    globalThis.ChatMessage = { getSpeaker: () => ({}) };
    globalThis.Macro = class {
        canExecute = true;
        constructor(data) { this.data = data; }
        async execute(scope) { executions.push([this.data.command, scope]); }
    };
    globalThis.CONFIG = { WITCHER: {} };
});

test('the item sheet opens both the manager and editor with valid DialogV2 content', async t => {
    t.mock.method(console, 'error', error => assert.fail(String(error)));
    globalThis.document = {
        createElement(tag) {
            const attributes = [];
            return { tagName: tag.toUpperCase(), attributes, set className(value) { attributes.push(value); } };
        }
    };
    t.after(() => { delete globalThis.document; });
    foundry.utils.escapeHTML = String;
    game.i18n.has = () => true;
    CONFIG.WITCHER.skillMap = { awareness: { name: 'awareness', label: 'Awareness' } };
    let openedEditor = false;
    foundry.applications = { api: { DialogV2: { async wait({ content }) {
        assert.equal(content.tagName, 'DIV');
        assert.equal(content.attributes.length, 0);
        assert.match(content.innerHTML, /^<div class="wttrpg-use-dialog">/);
        assert.match(content.innerHTML, /data-condition-autocomplete/);
        assert.match(content.innerHTML, /name="skillSource"/);
        assert.match(content.innerHTML, /value="awareness">Awareness/);
        assert.match(content.innerHTML, /value="Deduction">Deduction/);
        assert.doesNotMatch(content.innerHTML, /applyOnDamage/);
        openedEditor = true;
        return 'cancel';
    } } } };

    let manager;
    t.mock.method(appApi.ApplicationV2.prototype, 'render', async function () {
        manager = this;
        return this._prepareContext({});
    });
    const item = valuable();
    item.actor.items = [{ type: 'profession', system: { definingSkill: { skillName: 'Deduction' } } }];
    item.flags = [{ id: 'existing', name: 'Legacy', type: 'table', uuid: 'RollTable.table' }];
    const controls = [];
    addValuableUseManager({ document: item }, controls);
    const context = await controls[0].onClick();
    assert.equal(context.uses[0].img, 'icons/svg/lightning.svg');
    assert.equal(item.flags[0].img, undefined);
    await manager.constructor.DEFAULT_OPTIONS.actions.createUse.call(manager);
    assert.equal(openedEditor, true);
});

test('only an authenticated owner can request an approved GM macro; the item supplies its context', async () => {
    const item = valuable();
    await saveValuableUse(item, null, inline);
    const [use] = getValuableUses(item);
    const request = { itemUuid: item.uuid, useId: use.id, command: 'injected', actor: 'Actor.other' };
    assert.equal(use.runAs, 'gm');
    assert.equal(await handleValuableMacroQuery(request), 'NotAllowed');
    assert.equal(await handleValuableMacroQuery(request, { user: other }), 'NotAllowed');
    assert.equal(await handleValuableMacroQuery(request, { user: player }), true);
    assert.equal(executions.length, 1);
    assert.equal(executions[0][0], inline.command);
    assert.equal(executions[0][1].item, item);
    assert.equal(executions[0][1].actor, item.actor);
    assert.equal(executions[0][1].user, player);
});

test('modified and copied item flags cannot authorize GM code', async () => {
    const item = valuable();
    await saveValuableUse(item, null, inline);
    const copy = valuable('Actor.actor.Item.copy');
    copy.flags = structuredClone(item.flags);
    assert.equal(await handleValuableMacroQuery({ itemUuid: copy.uuid, useId: copy.flags[0].id }, { user: player }), 'UnapprovedMacro');
    item.flags[0].command = 'modified';
    assert.equal(await handleValuableMacroQuery({ itemUuid: item.uuid, useId: item.flags[0].id }, { user: player }), 'UnapprovedMacro');
    assert.equal(executions.length, 0);
});

test('a condition is checked against the requesting user and cannot be removed to authorize GM execution', async t => {
    const item = valuable();
    item.actor.system = { derivedStats: { hp: { value: 3 } } };
    const target = { id: 'monster-token', actor: { type: 'monster', testUserPermission: () => false } };
    player.targets = new Set([target]);
    gm.targets = new Set([{ actor: { type: 'character' } }]);
    t.after(() => {
        delete player.targets;
        delete player.viewedScene;
        delete gm.targets;
    });
    await saveValuableUse(item, null, {
        ...inline,
        img: 'icons/svg/book.svg',
        description: '<p>Activate below <strong>5 HP</strong>.</p>',
        condition: 'hp() < 5 && target.type === "monster" && source.type === "valuable"'
    });
    const [use] = item.flags;
    assert.equal(use.img, 'icons/svg/book.svg');
    assert.match(use.description, /<strong>5 HP<\/strong>/);
    const request = { itemUuid: item.uuid, useId: use.id };
    assert.equal(isValuableUseAvailable(item, use, player), true);
    assert.equal(isValuableUseAvailable(item, use, gm), false);
    assert.equal(await handleValuableMacroQuery(request, { user: player }), true);

    player.targets.clear();
    player.viewedScene = 'scene-a';
    game.scenes = new Map([
        ['scene-a', { tokens: new Map([[target.id, target]]) }],
        ['scene-b', { tokens: new Map([['other-token', { ...target, id: 'other-token' }]]) }]
    ]);
    assert.equal(await handleValuableMacroQuery({ ...request, targetTokenId: target.id }, { user: player }), true);
    assert.equal(await handleValuableMacroQuery({ ...request, targetTokenId: 'other-token' }, { user: player }), 'Unavailable');
    target.hidden = true;
    assert.equal(await handleValuableMacroQuery({ ...request, targetTokenId: target.id }, { user: player }), 'Unavailable');

    item.actor.system.derivedStats.hp.value = 6;
    assert.equal(await handleValuableMacroQuery(request, { user: player }), 'Unavailable');
    game.user = player;
    await assert.rejects(runValuableUse(item, use.id), { key: 'Unavailable' });
    game.user = gm;
    use.condition = '';
    assert.equal(await handleValuableMacroQuery(request, { user: player }), 'UnapprovedMacro');
    assert.equal(executions.length, 2);
});

test('a player uses the active GM query without sending macro code or supplied context', async () => {
    const item = valuable();
    await saveValuableUse(item, null, inline);
    const [use] = item.flags;
    game.user = player;
    await assert.rejects(runValuableUse(item, use.id), { key: 'NoGM' });
    users.activeGM = { async query(name, payload) {
        assert.equal(name, 'wttrpg-enhancements.runValuableMacro');
        assert.deepEqual(payload, { itemUuid: item.uuid, useId: use.id });
        game.user = gm;
        try { return await handleValuableMacroQuery(payload, { user: player }); }
        finally { game.user = player; }
    } };
    try { await runValuableUse(item, use.id); }
    finally { delete users.activeGM; }
    assert.equal(executions.length, 1);
});

test('linked macro changes require review and resaving while unrelated uses are preserved', async () => {
    const item = valuable();
    await saveValuableUse(item, null, inline);
    const macro = { uuid: 'Macro.macro', documentName: 'Macro', type: 'script', command: 'original', canExecute: true,
        async execute(scope) { executions.push([this.command, scope]); } };
    documents.set(macro.uuid, macro);
    const draft = { ...inline, name: 'Reference', source: 'reference', macroUuid: macro.uuid, reviewedMacro: { ...macro } };
    await saveValuableUse(item, null, draft);
    const [first, second] = getValuableUses(item);
    assert.ok(!JSON.stringify(approvals).includes(macro.command), 'approval must not publish linked macro code');
    macro.command = 'edited';
    const request = { itemUuid: item.uuid, useId: second.id };
    assert.equal(await handleValuableMacroQuery(request, { user: player }), 'UnapprovedMacro');
    await assert.rejects(saveValuableUse(item, second.id, draft), { key: 'ReviewMacro' });
    await saveValuableUse(item, second.id, { ...draft, reviewedMacro: { ...macro } });
    assert.equal(await handleValuableMacroQuery(request, { user: player }), true);
    assert.equal(executions[0][0], 'edited');
    await saveValuableUse(item, second.id, null);
    assert.deepEqual(getValuableUses(item), [first]);
});

test('player macros run locally and cannot be run through the GM query', async () => {
    const item = valuable();
    await saveValuableUse(item, null, { ...inline, runAs: 'player' });
    const [use] = item.flags;
    assert.equal(await handleValuableMacroQuery({ itemUuid: item.uuid, useId: use.id }, { user: player }), 'MissingUse');
    game.user = player;
    await runValuableUse(item, use.id);
    assert.equal(executions[0][1].user, player);
    game.user = { ...player, can: () => false };
    item.testUserPermission = user => user.id === player.id;
    await assert.rejects(runValuableUse(item, use.id), { key: 'MacroPermission' });
    await assert.rejects(saveValuableUse(item, use.id, inline), { key: 'NotAllowed' });
});

test('roll tables respect the user’s permission to mark a result as drawn', async () => {
    const item = valuable();
    const table = { uuid: 'RollTable.table', documentName: 'RollTable', replacement: false,
        testUserPermission: () => true, canUserModify: () => false, draw: async () => 'result' };
    documents.set(table.uuid, table);
    await saveValuableUse(item, null, { name: 'Read', type: 'table', tableUuid: table.uuid });
    game.user = player;
    await assert.rejects(runValuableUse(item, item.flags[0].id), { key: 'TablePermission' });
    table.replacement = true;
    assert.equal(await runValuableUse(item, item.flags[0].id), 'result');
});

test('self and target uses delegate to the system and old damage uses cannot run', async () => {
    const item = valuable();
    item.effects = [{ system: { applySelf: true, applyOnTarget: true, applyOnDamage: true } }];
    const applied = [];
    game.api = { async applyActiveEffectToActorViaId(...args) { applied.push(args); } };
    gm.targets = new Set([{ actor: item.actor }, { actor: item.actor }, { actor: null }]);
    for (const timing of ['applySelf', 'applyOnTarget']) {
        await saveValuableUse(item, null, { name: timing, type: 'effect', timing });
        await runValuableUse(item, item.flags.at(-1).id, applyValuableUseEffects);
    }
    assert.deepEqual(applied, [
        [item.actor.uuid, item.uuid, 'applySelf'],
        [item.actor.uuid, item.uuid, 'applyOnTarget']
    ]);
    const legacy = { id: 'old', name: 'Damage', type: 'effect', timing: 'applyOnDamage' };
    item.flags.push(legacy);
    assert.equal(isValuableUseAvailable(item, legacy), false);
    await assert.rejects(runValuableUse(item, legacy.id, applyValuableUseEffects), { key: 'ChooseEffectTiming' });
    await saveValuableUse(item, legacy.id, { ...legacy, timing: 'applyOnTarget' });
    assert.equal(isValuableUseAvailable(item, item.flags.at(-1)), true);
});

test('skill uses resolve the carrier’s current standard and profession skills before using the native rolls', async () => {
    const item = valuable();
    const standard = { name: 'awareness', attribute: { name: 'int' } };
    CONFIG.WITCHER.skillMap = { awareness: standard };
    item.actor.system = { skills: { int: { awareness: { value: 3 } } }, stats: { int: { value: 5 } } };
    item.actor.rollSkillCheck = async skill => skill;
    item.actor.doProfessionSkillRoll = async skill => skill;
    const profession = { skillName: 'Deduction', stat: 'int', level: 3 };
    item.actor.items = [{ type: 'profession', system: { definingSkill: profession } }];

    await saveValuableUse(item, null, { name: 'Look', type: 'skill', skillSource: 'standard', standardSkill: 'awareness' });
    await saveValuableUse(item, null, { name: 'Investigate', type: 'skill', skillSource: 'profession', professionSkill: 'Deduction' });
    const [look, investigate] = getValuableUses(item);
    game.user = player;
    assert.equal(await runValuableUse(item, look.id), standard);
    const current = { ...profession, level: 5 };
    item.actor.items[0].system.definingSkill = current;
    assert.equal(await runValuableUse(item, investigate.id), current);
    item.actor.items = [];
    await assert.rejects(runValuableUse(item, investigate.id), { key: 'SkillUnavailable' });
    item.actor = null;
    await assert.rejects(runValuableUse(item, look.id), { key: 'NeedsSkillActor' });
});
