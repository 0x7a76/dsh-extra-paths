/**
 * The runtime-context section that tells the model which extra roots this
 * session may write under and where it must not write or read, so it neither
 * refuses nor escalates pre-emptively and never tries a denied path.
 * @module dsh-extra-paths/context
 */
import { resolveRoots } from './resolve.js';
/**
 * Render the section text, or an empty string when there is nothing to say.
 *
 * Only rules with a visible effect are rendered: an inactive entry (missing,
 * rejected or foreign) grants and restricts nothing, so it is the preview's job
 * — not the model's — to report it.
 * @param readConfig - current configuration snapshot.
 * @param cwd - the calling session's workspace (undefined outside a session).
 * @returns the prompt text.
 */
export function renderExtraPathsContext(readConfig, cwd) {
    if (cwd === undefined || cwd === '')
        return '';
    const report = resolveRoots(readConfig(), cwd);
    if (report.roots.length === 0 && report.readOnly.length === 0 && report.denied.length === 0
        && report.nameRules.length === 0)
        return '';
    const lines = [];
    if (report.roots.length > 0) {
        lines.push('Additional configured writable roots for this session (no approval is required to write under them):');
        for (const root of report.roots) {
            const reach = root.scope === 'always-write'
                ? 'writable regardless of the standing sandbox mode'
                : 'writable while the policy is workspace-write';
            lines.push(`  - ${root.root} — ${reach} (surfaces: ${root.surfaces.join('+')})`);
        }
    }
    if (report.readOnly.length > 0) {
        lines.push('Read-only roots (do not write):');
        for (const rule of report.readOnly) {
            lines.push(`  - ${rule.root} (surfaces: ${rule.surfaces.join('+')})`);
        }
    }
    if (report.denied.length > 0) {
        lines.push('Denied paths (do not read or write):');
        for (const rule of report.denied) {
            lines.push(`  - ${rule.root} (surfaces: ${rule.surfaces.join('+')})`);
        }
    }
    // NAME rules are not concrete paths, so they get their own bullets: telling
    // the model "the component .git is denied ANYWHERE under the workspace and the
    // writable roots" is what stops it from trying one repository after another.
    const deniedNames = report.nameRules.filter(rule => rule.access === 'deny');
    if (deniedNames.length > 0) {
        lines.push('Denied names (matched at any depth under the session workspace and the configured writable roots; do not read or write them):');
        for (const rule of deniedNames) {
            lines.push(`  - ${rule.raw} (surfaces: ${rule.surfaces.join('+')})`);
        }
    }
    const readOnlyNames = report.nameRules.filter(rule => rule.access === 'read');
    if (readOnlyNames.length > 0) {
        lines.push('Read-only names (matched at any depth; do not write them):');
        for (const rule of readOnlyNames) {
            lines.push(`  - ${rule.raw} (surfaces: ${rule.surfaces.join('+')})`);
        }
    }
    return lines.join('\n');
}
//# sourceMappingURL=context.js.map