/**
 * The mode gate: which configured roots one call may write under.
 * `write` rides the session mode; `always-write` survives `read-only` too.
 * @module dsh-extra-paths/grant
 */
import type { Surface } from './config.js';
import type { ResolvedRoot } from './resolve.js';
/** The modes a resolved policy can carry (kept local so the plugin imports no core type). */
export type SandboxModeLike = 'read-only' | 'workspace-write' | 'danger-full-access';
/**
 * Select the roots a call under `mode` may write under for one surface.
 * @param mode - the resolved per-call sandbox mode.
 * @param roots - effective roots for this session workspace.
 * @param surface - the enforcement surface asking.
 * @returns the roots to grant; empty means "delegate unchanged".
 */
export declare function grantFor(mode: SandboxModeLike, roots: readonly ResolvedRoot[], surface: Surface): readonly ResolvedRoot[];
