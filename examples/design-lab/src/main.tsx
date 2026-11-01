import "@fontsource-variable/geist";
import "@facilis/ui/theme.css";
import "./directions.css";
import "./lab.css";

import { createRoot } from "react-dom/client";
import { Lab } from "./lab.tsx";
import { applyPreferences, readPreferences } from "./preferences.ts";

const host = document.getElementById("root");
if (host === null) throw new Error("design lab: #root is missing");

// Apply stored preferences before the first render so the stage never flashes another line.
applyPreferences(readPreferences());
createRoot(host).render(<Lab />);
