export type TransportMode = 'stdio' | 'http'

export function selectTransportMode(
  args: readonly string[] = process.argv.slice(2),
  env: Partial<Record<string, string | undefined>> = process.env,
): TransportMode {
  const hasHttpFlag = args.includes('--http')
  const hasStdioFlag = args.includes('--stdio')
  if (hasHttpFlag && hasStdioFlag) {
    throw new Error('Choose only one transport: --http or --stdio')
  }
  if (hasHttpFlag) return 'http'
  if (hasStdioFlag) return 'stdio'

  const configured = env.MCP_TRANSPORT?.trim().toLowerCase()
  if (!configured || configured === 'stdio') return 'stdio'
  if (configured === 'http') return 'http'
  throw new Error(`Unsupported MCP_TRANSPORT value: ${env.MCP_TRANSPORT}`)
}
