/**
 * The runtime-context section that tells the model which extra roots this
 * session may write under, so it neither refuses nor escalates pre-emptively.
 * @module dsh-extra-paths/context
 */
import { resolveRoots } from './resolve.js';
/**
 * Render the section text, or an empty string when there is nothing to say.
 * @param readConfig - current configuration snapshot.
 * @param cwd - the calling session's workspace (undefined outside a session).
 * @returns the prompt text.
 */
export function renderExtraPathsContext(readConfig, cwd) {
    if (cwd === undefined || cwd === '')
        return '';
    const report = resolveRoots(readConfig(), cwd);
    if (report.roots.length === 0)
        return '';
    const lines = report.roots.map(root => {
        const reach = root.scope === 'always-write'
            ? 'writable regardless of the standing sandbox mode'
            : 'writable while the policy is workspace-write';
        return `  - ${root.root} — ${reach} (surfaces: ${root.surfaces.join('+')})`;
    });
    return [
        'Additional configured writable roots for this session (no approval is required to write under them):',
        ...lines,
    ].join('\n');
}
//# sourceMappingURL=context.js.map