import { t as createPlayerFactory } from "./player-BYFGG-d9.mjs";
import xterm from "@xterm/xterm";
//#region src/browser.ts
const createPlayer = createPlayerFactory(() => xterm.Terminal);
function createTermlessPlayer(element, source, options = {}) {
	return createPlayer(element, source, options);
}
//#endregion
export { createTermlessPlayer };

//# sourceMappingURL=browser.mjs.map