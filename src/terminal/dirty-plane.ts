export interface DirtyRect {
  readonly row: number
  readonly col: number
  readonly width: number
  readonly height: number
}

export interface BufferLike<TCell> {
  readonly cols: number
  readonly rows: number
  getCell(col: number, row: number): TCell
}

export function cloneBufferRows<TCell>(buffer: BufferLike<TCell>): TCell[][] {
  const rows: TCell[][] = new Array(buffer.rows)
  for (let row = 0; row < buffer.rows; row++) {
    const cells: TCell[] = new Array(buffer.cols)
    for (let col = 0; col < buffer.cols; col++) cells[col] = buffer.getCell(col, row)
    rows[row] = cells
  }
  return rows
}

export function bufferFromRows<TCell>(rows: readonly TCell[][]): BufferLike<TCell> {
  const cols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  return {
    get cols() {
      return cols
    },
    get rows() {
      return rows.length
    },
    getCell(col: number, row: number): TCell {
      return rows[row]?.[col] as TCell
    },
  }
}

export function mergeDirtyRows<TCell>(
  currentRows: readonly TCell[][],
  nextBuffer: BufferLike<TCell>,
  dirtyRects: readonly DirtyRect[],
): TCell[][] {
  if (
    dirtyRects.length === 0 ||
    currentRows.length !== nextBuffer.rows ||
    currentRows.some((row) => row.length !== nextBuffer.cols)
  ) {
    return cloneBufferRows(nextBuffer)
  }
  const merged = currentRows.map((row) => [...row])
  for (const rect of dirtyRects) {
    const rowEnd = Math.min(nextBuffer.rows, rect.row + rect.height)
    const colEnd = Math.min(nextBuffer.cols, rect.col + rect.width)
    for (let row = Math.max(0, rect.row); row < rowEnd; row++) {
      const target = merged[row]
      if (!target) continue
      for (let col = Math.max(0, rect.col); col < colEnd; col++) {
        target[col] = nextBuffer.getCell(col, row)
      }
    }
  }
  return merged
}
