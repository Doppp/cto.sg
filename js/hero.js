// Entry point for the page. The page works fully without it; it only adds the hero globe.
import { mountGlobe } from "./globe.js"

document.querySelectorAll("[data-globe]").forEach(mountGlobe)
