export { terminalMatchers } from "./matchers.ts"
export {
  createTestTerminal,
  createTestTerminalByName,
  createTerminalFixture,
  createTerminalFixtureAsync,
  describeBackends,
  backendCases,
} from "./fixture.ts"
export type {
  TestTerminalOptions,
  SyncTestTerminalOptions,
  NamedTestTerminalOptions,
  TerminalFixtureOptions,
  BackendCase,
} from "./fixture.ts"
export { terminalSerializer, terminalSnapshot } from "./serializer.ts"
export type { TerminalSnapshotMarker } from "./serializer.ts"
export { svgTerminalSerializer, svgTerminalSnapshot } from "./svg-serializer.ts"
export type { SvgTerminalSnapshotMarker } from "./svg-serializer.ts"
