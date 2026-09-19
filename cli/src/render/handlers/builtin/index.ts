// Core's built-in handlers.

import type { Handler } from "../types.js";
import { downloadHandler } from "./download.js";
import { fmHandler } from "./fm.js";
import { fmCodeHandler } from "./fm-code.js";
import { galleryHandler } from "./gallery.js";

export const BUILTIN_HANDLERS: Handler[] = [fmHandler, fmCodeHandler, galleryHandler, downloadHandler];
