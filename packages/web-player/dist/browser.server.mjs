import { t as createPlayerFactory } from "./player-BYFGG-d9.mjs";
import { createRequire } from "node:module";
//#region src/browser.server.ts
const createPlayer = createPlayerFactory(() => {
	return createRequire(import.meta.url)("@xterm/xterm").Terminal;
});
function createTermlessPlayer(element, source, options = {}) {
	return createPlayer(element, source, options);
}
//#endregion
export { createTermlessPlayer };

//# sourceMappingURL=browser.server.mjs.map