type XtermCell = import("@xterm/headless").IBufferCell

interface LinkedCell extends XtermCell {
  readonly extended?: { readonly urlId?: number }
}

export interface XtermLinkCore {
  readonly _oscLinkService?: {
    getLinkData(linkId: number): { uri: string } | undefined
  }
}

// The pinned xterm parser keeps OSC 8 IDs on cells and URIs in its internal
// link service. Both the viewport and probe backend must resolve that one path.
export function resolveXtermCellHyperlink(cell: XtermCell, core: XtermLinkCore): string | null {
  const linkId = (cell as LinkedCell).extended?.urlId
  if (!linkId) return null
  const service = core._oscLinkService
  if (!service) throw new Error("xterm OSC 8 cell has a link id but no link service")
  const uri = service.getLinkData(linkId)?.uri
  if (!uri) throw new Error(`xterm OSC 8 link id ${linkId} has no URI`)
  return uri
}
