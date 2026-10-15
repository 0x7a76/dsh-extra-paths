/**
 * The runtime-context section that tells the model which extra roots this
 * session may write under, so it neither refuses nor escalates pre-emptively.
 * @module dsh-extra-paths/context
 */
import type { ExtraPathsConfig } from './config.js';
/**
 * Render the section text, or an empty string when there is nothing to say.
 * @param readConfig - current configuration snapshot.
 * @param cwd - the calling session's workspace (undefined outside a session).
 * @returns the prompt text.
 */
export declare function renderExtraPathsContext(readConfig: () => ExtraPathsConfig, cwd: string | undefined): string;
