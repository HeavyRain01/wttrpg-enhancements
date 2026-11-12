export function getSkillLabel(skill) {
    const canonicalKey = `WITCHER.skills.${skill.name}.label`;
    const key = game.i18n.has(skill.label) ? skill.label : canonicalKey;
    return game.i18n.has(key) ? game.i18n.localize(key) : game.i18n.localize(skill.label);
}
