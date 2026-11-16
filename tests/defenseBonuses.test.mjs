import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_TYPES } from '../src/lib/util/constants.js';
import { getSituationalBonuses } from '../src/lib/util/situationalBonus.js';

const DialogV2 = {};
globalThis.foundry = {
    abstract: { TypeDataModel: class {} },
    data: { fields: {} },
    documents: { collections: {} },
    applications: {
        api: { DialogV2, HandlebarsApplicationMixin: Base => Base },
        sheets: { ItemSheetV2: class {} },
        handlebars: { renderTemplate: async (_path, { bonuses }) => bonuses },
        ux: { TextEditor: { implementation: { enrichHTML: async text => text } } }
    }
};
const { wrapAddItem } = await import('../src/lib/flows/addItemFlow.js');
const { wrapCreateDefenseOption, wrapSkillDefense } = await import('../src/lib/flows/defenseFlow.js');

const attacker = { name: 'Bandit', uuid: 'Actor.bandit' };
const source = { name: 'Axe', uuid: 'Item.axe' };
const damage = { itemUuid: source.uuid, type: 'slashing' };
const attack = { attacker: attacker.uuid, attackDamageObject: damage, totalAttack: 15 };
const block = { value: 'block' };
let defender, shield, otherShield, armor, valuable;

function inventoryItem(id, type, system) {
    return { id, type, system, uuid: `${defender.uuid}.Item.${id}`, name: id };
}

function bonus(id, system = {}, flags = {}) {
    const data = {
        ...inventoryItem(id, ITEM_TYPES.SITUATIONAL_BONUS, { scope: 'defense', formula: '1d6', ...system }),
        flags
    };
    return {
        ...data,
        getFlag: (module, name) => flags[module]?.[name],
        toObject: () => structuredClone(data)
    };
}

beforeEach(() => {
    defender = {
        uuid: 'Actor.defender',
        items: Object.assign([], { get(id) { return this.find(item => item.id === id); } }),
        system: { derivedStats: { sta: { value: 5 } } },
        getRollData: () => ({ bonus: 2 })
    };
    shield = inventoryItem('Kite Shield', 'armor', { location: 'Shield' });
    otherShield = inventoryItem('Buckler', 'armor', { location: 'Shield' });
    armor = inventoryItem('Gambeson', 'armor', { equipped: true });
    valuable = inventoryItem('Amulet', 'valuable', { isCarried: true });
    defender.items.push(shield, otherShield, armor, valuable);
    globalThis.game = { i18n: { localize: key => key }, items: [] };
    globalThis.fromUuid = async uuid => [attacker, source].find(doc => doc.uuid === uuid);
    globalThis.Roll = { replaceFormulaData: (formula, data) => formula.replace('@bonus', data.bonus) };
    DialogV2.wait = () => assert.fail('No bonus picker should open');
});

test('defense type, selected shield, incoming attack, and defender resources all gate a bonus', () => {
    defender.items.push(
        bonus('brace', {
            parentItemUuid: shield.uuid,
            applicableDefenses: ['block'],
            condition: "sta() >= 5 && attacker.name === 'Bandit' && source.name === 'Axe' && defense.item.name === 'Kite Shield'"
        }),
        bonus('global')
    );
    const context = { attacker, source, damage, target: defender, defense: { type: 'block', item: shield } };
    const available = changes => getSituationalBonuses(defender, 'defense', { ...context, ...changes }).map(item => item.id);
    assert.deepEqual(available(), ['brace', 'global']);
    assert.deepEqual(available({ defense: { type: 'block', item: otherShield } }), ['global']);
    assert.deepEqual(available({ defense: { type: 'parry', item: shield } }), ['global']);
    assert.deepEqual(available({ attacker: { name: 'Monster' } }), ['global']);
    defender.system.derivedStats.sta.value = 4;
    assert.deepEqual(available(), ['global']);
});

test('carried armor and valuables supply defense bonuses, with equipment state available as a condition', () => {
    defender.items.push(
        bonus('armor-dodge', { parentItemUuid: armor.uuid, applicableDefenses: ['dodge', 'reposition'] }),
        bonus('worn-armor', { parentItemUuid: armor.uuid, condition: 'item.system.equipped' }),
        bonus('amulet-defense', { parentItemUuid: valuable.uuid }),
        bonus('amulet-skill', { parentItemUuid: valuable.uuid, scope: 'skill', applicableSkills: ['awareness'] })
    );
    const context = { defense: { type: 'dodge' } };
    const available = defense => getSituationalBonuses(defender, 'defense', { defense }).map(item => item.id);
    assert.deepEqual(available(context.defense), ['armor-dodge', 'worn-armor', 'amulet-defense']);
    assert.equal(getSituationalBonuses(defender, 'skill', { source: { name: 'awareness' } }).length, 1);
    assert.equal(getSituationalBonuses(defender, 'skill', { source: { name: 'dodge' } }).length, 0);
    armor.system.equipped = false;
    assert.deepEqual(available(context.defense), ['armor-dodge', 'amulet-defense']);
    assert.deepEqual(available({ type: 'reposition' }), ['armor-dodge', 'amulet-defense']);
    armor.system.isCarried = false;
    valuable.system.isStored = true;
    assert.deepEqual(getSituationalBonuses(defender, 'defense', context), []);
});

test('Dodge and Reposition open the picker with no defense item when their armor bonus applies', async () => {
    armor.system.equipped = false;
    defender.items.push(bonus('gambeson', {
        parentItemUuid: armor.uuid,
        applicableDefenses: ['dodge', 'reposition']
    }));
    let opened = 0;
    DialogV2.wait = async ({ content }) => {
        opened += 1;
        assert.deepEqual(content.map(card => card.id), ['gambeson']);
        return { formula: '' };
    };
    const wrapped = (skill, _attack, _modifiers, action) => [skill.skillName, action.value];
    for (const [skillName, value] of [['dodge', 'dodge'], ['athletics', 'reposition']]) {
        assert.deepEqual(
            await wrapSkillDefense.call(defender, wrapped, { skillName }, attack, {}, { value }),
            [skillName, value]
        );
    }
    assert.equal(opened, 2);
});

test('the bonus picker adds selected formulas to the native custom modifier and honors cancellation', async () => {
    const skill = { skillName: 'melee' };
    const modifiers = { customDef: '-2', extraDefense: true };
    const wrapped = (...args) => args;
    const run = () => wrapSkillDefense.call(defender, wrapped, skill, attack, modifiers, block, shield.id);
    assert.deepEqual(await run(), [skill, attack, modifiers, block, shield.id, undefined]);

    defender.items.push(bonus('brace', { parentItemUuid: shield.uuid, formula: '1d6 + @bonus' }));
    DialogV2.wait = async config => {
        assert.deepEqual(config.content.map(card => card.id), ['brace']);
        const form = { querySelectorAll: () => [{ dataset: { formula: config.content[0].formula } }] };
        return config.buttons[0].callback(null, { form });
    };
    assert.deepEqual(await run(), [
        skill, attack, { customDef: '-2+(1d6 + 2)', extraDefense: true }, block, shield.id, undefined
    ]);
    DialogV2.wait = async () => ({ formula: '' });
    assert.deepEqual(await run(), [skill, attack, modifiers, block, shield.id, undefined]);
    DialogV2.wait = async () => null;
    assert.equal(await run(), undefined);
});

test('a native defense option provided by an item can use the bonuses attached to that item', async () => {
    const sign = inventoryItem('Ward', 'spell', {});
    defender.items.push(sign, bonus('ward', { parentItemUuid: sign.uuid }));
    const action = wrapCreateDefenseOption.call(sign, () => ({ value: sign.name }), {});
    DialogV2.wait = async ({ content }) => {
        assert.deepEqual(content.map(card => card.id), ['ward']);
        return { formula: '' };
    };
    const result = await wrapSkillDefense.call(
        defender, (...args) => args, { skillName: 'spellcasting' }, attack, {}, action
    );
    assert.equal(result[3], action);
    assert.equal(result[4], undefined);
});

test('adding a configured valuable copies its bonus once and binds it to the actor item', async () => {
    const worldItem = { ...valuable, uuid: 'Item.amulet' };
    game.items = [bonus('template', { parentItemUuid: worldItem.uuid })];
    defender.createEmbeddedDocuments = async (_type, data) => {
        defender.items.push(...data.map(copy => bonus(copy.id, copy.system, copy.flags)));
    };
    const add = () => wrapAddItem.call(defender, () => {}, worldItem, 1);
    await add();
    await add();
    const available = getSituationalBonuses(defender, 'defense', { defense: { type: 'dodge' } });
    assert.equal(available.length, 1);
    assert.equal(available[0].system.parentItemUuid, valuable.uuid);
});
