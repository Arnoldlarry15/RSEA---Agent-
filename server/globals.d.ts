/**
 * Global type declarations for the server runtime.
 *
 * The triple-slash directive below explicitly pulls in `@types/node`, making
 * Node.js globals (process, Buffer, __dirname, etc.) available to every
 * server-side TypeScript file.  Without this, TypeScript only resolves these
 * types if `@types/node` happens to be the first auto-discovered type package —
 * which is fragile in stripped CI environments or when the tsconfig `types`
 * array is later restricted.
 */

/// <reference types="node" />
