/**
 * Core types for the @termless/census probe framework.
 *
 * Probes feed ANSI sequences to backends and check whether features work correctly.
 * Results are recorded as structured data for compatibility matrices.
 */

import type { TerminalBackend } from "../../../src/types.ts"

export type SupportLevel = "yes" | "no" | "partial" | "unknown"

export interface ProbeResult {
  support: SupportLevel
  notes?: string
}

export interface ProbeDefinition {
  id: string
  name: string
  category: string
  spec?: string
  probe: (backend: TerminalBackend) => ProbeResult
}

export interface BackendInfo {
  name: string
  version: string
  engine: string
}

export interface CensusEntry {
  id: string
  name: string
  category: string
  spec?: string
  results: Record<string, ProbeResult>
}

export interface CensusDatabase {
  generated: string
  termlessVersion: string
  backends: Record<string, BackendInfo>
  features: CensusEntry[]
  stats: {
    totalProbes: number
    totalBackends: number
    totalYes: number
    totalNo: number
    totalPartial: number
    totalUnknown: number
  }
}
