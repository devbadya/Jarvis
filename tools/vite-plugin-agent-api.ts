import type { Connect, Plugin } from 'vite'
import { handleAgentApiRequest } from './agent-api.ts'

/**
 * Serves `/api/search` and `/api/fetch` from the Vite dev and preview servers.
 *
 * The production Pages build does not include this plugin's routes — there is
 * no Node process there. Locally it is how DuckDuckGo search and page reads
 * skip CORS without going through the reader.
 */
export function agentApi(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    void handleAgentApiRequest(req, res)
      .then((handled) => {
        if (!handled) next()
      })
      .catch((error: unknown) => {
        if (!res.headersSent) {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Request failed' }))
        }
      })
  }

  return {
    name: 'jarvis:agent-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
