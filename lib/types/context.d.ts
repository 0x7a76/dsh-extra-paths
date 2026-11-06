/**
 * The runtime-context section that tells the model which extra roots this
 * session may write under and where it must not write or read, so it neither
 * refuses nor escalates pre-emptively and never tries a denied path.
 * @module dsh-extra-paths/context
 */
import type { ExtraPathsConfig } from './config.js';
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
export declare function renderExtraPathsContext(readConfig: () => ExtraPathsConfig, cwd: string | undefined): string;
