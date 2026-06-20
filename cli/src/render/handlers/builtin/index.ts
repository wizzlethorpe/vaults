// Registry of built-in handlers shipped with vaults-cli.
//
// User-defined handlers (loaded from .vaults/handlers/) override built-ins
// of the same name; see buildRegistry() in handlers/types.ts.

import type { Handler } from "../types.js";
import { battlemapHandler } from "./battlemap.js";
import { diceHandler } from "./dice.js";
import { fmHandler } from "./fm.js";
import { fmCodeHandler } from "./fm-code.js";
import { galleryHandler } from "./gallery.js";
import { statblockHandler } from "./statblock.js";

export const BUILTIN_HANDLERS: Handler[] = [
  diceHandler, fmHandler, fmCodeHandler, statblockHandler, battlemapHandler, galleryHandler,
];
