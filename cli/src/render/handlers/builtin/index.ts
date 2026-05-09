// Registry of built-in handlers shipped with vaults-cli.
//
// User-defined handlers (loaded from .vaults/handlers/) override built-ins
// of the same name; see buildRegistry() in handlers/types.ts.

import type { Handler } from "../types.js";
import { diceHandler } from "./dice.js";
import { fmHandler } from "./fm.js";

export const BUILTIN_HANDLERS: Handler[] = [diceHandler, fmHandler];
