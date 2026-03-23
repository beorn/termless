/**
 * Shared render helper for CLI output via silvery.
 *
 * Uses renderString() to produce styled ANSI output from React components.
 */

import type React from "react"
import { renderString } from "silvery"

export async function printComponent(element: React.ReactElement): Promise<void> {
  const width = process.stdout.columns || 80
  const output = await renderString(element, { width })
  console.log(output)
}
