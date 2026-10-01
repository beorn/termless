import { t as createPlayerFactory } from "./player-BYFGG-d9.mjs";
import { Terminal } from "@xterm/xterm";
//#region src/browser.ts
const createPlayer = createPlayerFactory(() => Terminal);
function createTermlessPlayer(element, source, options = {}) {
	return createPlayer(element, source, options);
}
//#endregion
export { createTermlessPlayer };

//# sourceMappingURL=browser.mjs.map