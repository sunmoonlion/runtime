// Presence and the local API share a listener. Its four public fields need no ticket.
export { startLocalApi as startPresence } from "./localApi.js";
export type { LocalApiOptions as PresenceOptions, LocalApiHandle as PresenceHandle } from "./localApi.js";
