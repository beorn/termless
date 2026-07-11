const WINDOW_OP_RE = /\x1b\[(14|18)t|\x1b\[\?996n/g
const MOUSE_DECSET_RE = /\x1b\[\?([\d;]+)([hl])/g

export type WindowOpQuery = "14t" | "18t" | "?996n"

export function scanWindowOpQueries(data: string, onQuery: (query: WindowOpQuery) => void): void {
  if (!data.includes("\x1b[")) return
  WINDOW_OP_RE.lastIndex = 0
  for (let match = WINDOW_OP_RE.exec(data); match !== null; match = WINDOW_OP_RE.exec(data)) {
    if (match[1] === "14") onQuery("14t")
    else if (match[1] === "18") onQuery("18t")
    else onQuery("?996n")
  }
}

export function scanMouseDecset(data: string, onToggle: (param: "1000" | "1002" | "1003", on: boolean) => void): void {
  if (!data.includes("\x1b[?")) return
  MOUSE_DECSET_RE.lastIndex = 0
  for (let match = MOUSE_DECSET_RE.exec(data); match !== null; match = MOUSE_DECSET_RE.exec(data)) {
    const on = match[2] === "h"
    for (const param of match[1]!.split(";")) {
      if (param === "1000" || param === "1002" || param === "1003") {
        onToggle(param, on)
      }
    }
  }
}

export interface MouseDecsetState {
  m1000: boolean
  m1002: boolean
  m1003: boolean
}

export function scanMouseDecsetTracking(
  data: string,
  trackMouse: boolean,
  mouseModes: MouseDecsetState,
  onChange: () => void,
): void {
  if (!trackMouse || !data.includes("\x1b[?")) return
  let changed = false
  scanMouseDecset(data, (param, on) => {
    if (param === "1000") ((mouseModes.m1000 = on), (changed = true))
    else if (param === "1002") ((mouseModes.m1002 = on), (changed = true))
    else if (param === "1003") ((mouseModes.m1003 = on), (changed = true))
  })
  if (changed) onChange()
}
