declare module "gifenc" {
  export interface GIFEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: {
        palette?: number[][]
        delay?: number
        transparent?: boolean
        transparentIndex?: number
        repeat?: number
        dispose?: number
      },
    ): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    reset(): void
  }

  export function GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): GIFEncoderInstance
  export function quantize(rgba: Uint8Array, maxColors: number, options?: { format?: string }): number[][]
  export function applyPalette(rgba: Uint8Array, palette: number[][], format?: string): Uint8Array
  export function nearestColorIndex(palette: number[][], color: number[]): number
  export function nearestColor(palette: number[][], color: number[]): number[]
  export function snapColorsToPalette(palette: number[][], knownColors: number[][], threshold?: number): void
  export function prequantize(
    rgba: Uint8Array,
    options?: { roundRGB?: number; roundAlpha?: number; oneBitAlpha?: boolean | number },
  ): Uint8Array
}
