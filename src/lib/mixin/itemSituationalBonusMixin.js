import { DOCUMENT_TYPES, ITEM_TYPES, MODULE, PASSIVE_BONUS_ITEM_TYPES, SITUATIONAL_BONUS_SCOPES } from '../util/constants.js';
import { matchesBonusParent } from '../util/situationalBonus.js';

const ATTACHMENT_SOURCE = 'situationalBonusAttachmentSource';

export async function getAttachedItemSituationalBonuses(item) {
    if (!item?.uuid) return [];
    const collections = [item.actor?.items, game.items].filter(Boolean);
    const pack = item.pack && game.packs.get(item.pack);
    if (pack) {
        const index = await pack.getIndex({ fields: ['system.parentItemUuid'] });
        const entries = index.filter(entry => entry.type === ITEM_TYPES.SITUATIONAL_BONUS
            && entry.system?.parentItemUuid === item.uuid);
        collections.push(await Promise.all(entries.map(entry => pack.getDocument(entry._id))));
    }
    return collections.flatMap(collection => Array.from(collection)).filter(entry =>
        entry?.type === ITEM_TYPES.SITUATIONAL_BONUS && matchesBonusParent(item, entry.system?.parentItemUuid)
    );
}

export async function cloneAttachedSituationalBonusesToActor(sourceItem, targetActor, targetItem) {
    if (sourceItem?.uuid === targetItem.uuid) return [];
    const bonuses = await getAttachedItemSituationalBonuses(sourceItem);
    if (!bonuses.length) return [];
    const copiedSources = new Set(targetActor.items
        .filter(bonus => bonus.type === ITEM_TYPES.SITUATIONAL_BONUS
            && matchesBonusParent(targetItem, bonus.system.parentItemUuid))
        .map(bonus => bonus.getFlag(MODULE.ID, ATTACHMENT_SOURCE)));
    const data = [];
    for (const bonus of bonuses) {
        const sourceUuid = bonus.getFlag(MODULE.ID, ATTACHMENT_SOURCE) ?? bonus.uuid;
        if (copiedSources.has(sourceUuid)) continue;
        const copy = bonus.toObject();
        delete copy._id;
        copy.system.parentItemUuid = targetItem.uuid;
        copy.flags ??= {};
        copy.flags[MODULE.ID] ??= {};
        copy.flags[MODULE.ID][ATTACHMENT_SOURCE] = sourceUuid;
        data.push(copy);
        copiedSources.add(sourceUuid);
    }
    if (!data.length) return [];
    return targetActor.createEmbeddedDocuments(DOCUMENT_TYPES.ITEM, data);
}

export const ItemSituationalBonusMixin = Superclass => class extends Superclass {
    getAttachedSituationalBonuses() {
        return getAttachedItemSituationalBonuses(this.document);
    }

    async createAttachedSituationalBonus(source = null) {
        const { ATTACK, DEFENSE, SKILL } = SITUATIONAL_BONUS_SCOPES;
        const passive = PASSIVE_BONUS_ITEM_TYPES.includes(this.document.type);
        const data = source?.toObject?.() ?? {
            name: game.i18n.localize('WTTRPGEnhancements.SituationalBonus.NewBonus'),
            type: ITEM_TYPES.SITUATIONAL_BONUS,
            img: 'icons/svg/upgrade.svg',
            system: { formula: '1', imageLayout: 'left', scope: passive ? DEFENSE : ATTACK, condition: '', description: '' }
        };
        delete data._id;
        data.system ??= {};
        data.system.parentItemUuid = this.document.uuid;
        if (data.flags?.[MODULE.ID]) delete data.flags[MODULE.ID][ATTACHMENT_SOURCE];
        if (!passive && data.system.scope === SKILL) data.system.scope = ATTACK;

        let created;
        if (this.document.actor) {
            [created] = await this.document.actor.createEmbeddedDocuments(DOCUMENT_TYPES.ITEM, [data]);
        } else if (this.document.pack) {
            created = await Item.create(data, { pack: this.document.pack });
        } else {
            created = await Item.create(data);
        }
        this.render(true);
        return created;
    }

    async onDropSituationalBonus(event) {
        const dragData = TextEditor.getDragEventData(event);
        const source = dragData?.uuid ? await fromUuid(dragData.uuid) : null;
        if (source?.type !== ITEM_TYPES.SITUATIONAL_BONUS) {
            return ui.notifications.warn(game.i18n.localize('WTTRPGEnhancements.SituationalBonus.OnlyBonuses'));
        }
        await this.createAttachedSituationalBonus(source);
    }

    static async onCreateSituationalBonus(event) {
        event.preventDefault();
        const bonus = await this.createAttachedSituationalBonus();
        bonus?.sheet?.render(true);
    }

    static async onOpenSituationalBonus(event, element) {
        event.preventDefault();
        const bonus = (await this.getAttachedSituationalBonuses()).find(item => item.id === element.dataset.cardId);
        bonus?.sheet?.render(true);
    }

    static async onRemoveSituationalBonus(event, element) {
        event.preventDefault();
        const bonus = (await this.getAttachedSituationalBonuses()).find(item => item.id === element.dataset.cardId);
        await bonus?.delete();
        this.render(true);
    }
};
