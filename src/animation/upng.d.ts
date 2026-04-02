declare module "upng-js" {
  interface DecodedImage {
    width: number
    height: number
    depth: number
    ctype: number
    frames: Array<{ rect: { x: number; y: number; width: number; height: number }; delay: number; data: ArrayBuffer }>
    tabs: Record<string, unknown>
    data: ArrayBuffer
  }

  export function encode(
    imgs: ArrayBuffer[],
    w: number,
    h: number,
    cnum: number,
    dels?: number[],
    forbidPlte?: boolean,
  ): ArrayBuffer

  export function decode(buf: ArrayBuffer): DecodedImage

  export function toRGBA8(out: DecodedImage): ArrayBuffer[]
}
