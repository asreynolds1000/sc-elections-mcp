import { createMcpFetchHandler } from '../src/serverless-handler.js'

// Files in /api use Vercel's Node.js runtime by default. This route cannot use
// Edge because its registered tools depend on Node APIs and node-html-parser.
const fetch = createMcpFetchHandler()

export default { fetch }

