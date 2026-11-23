import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import {
  registerPreviewRoute,
  type PeerLike,
  type PreviewRouteContext,
  type ServerResponseLike,
} from '../src/preview.js'

type CapturedRoute = Parameters<PreviewRouteContext['webServer']['register']>[0]

/** Register the route into a fake context and return its captured registration. */
function harness(connection: PreviewRouteContext['connection']): CapturedRoute {
  let route: CapturedRoute | undefined
  const ctx: PreviewRouteContext = {
    webServer: {
      register(next) {
        route = next
        return () => {}
      },
    },
    connection,
    effect(callback) {
      callback()
      return () => {}
    },
  }
  registerPreviewRoute(ctx, { readConfig: () => normalizeConfig(undefined), warn: vi.fn() })
  if (route === undefined) throw new Error('preview route was not registered')
  return route
}

/** A response double that records the full response lifecycle the handler uses. */
function response(): ServerResponseLike & { status: number; body: string } {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status },
    end(body) { this.body = body ?? '' },
  }
}

const request = { method: 'GET', url: `/extra-paths/resolved?cwd=${encodeURIComponent(tmpdir())}` }

describe('preview route registration', () => {
  it('declares required admission and serves without the removed requestRejection', async () => {
    const route = harness({})
    expect(route.auth).toBe('required')
    const res = response()
    // 0.2.3 shape: WebServer admitted the request and passes the Peer, but the
    // Connection service no longer exposes requestRejection.
    await route.handler(request, res, { principal: { kind: 'owner' } })
    expect(res.status).toBe(200)
    const payload = JSON.parse(res.body) as { workspaceCwd?: string }
    expect(payload.workspaceCwd).toBeTruthy()
  })

  it('keeps the 0.1.5–0.2.2 Connection rejection fence', async () => {
    const route = harness({ requestRejection: () => 401 })
    const res = response()
    await route.handler(request, res)
    expect(res.status).toBe(401)
    expect(res.body).toBe('unauthorized')
  })

  it('rejects a non-owner authenticated Peer on hosts that pass one', async () => {
    const route = harness({})
    const res = response()
    const peer: PeerLike = { principal: { kind: 'operator' } }
    await route.handler(request, res, peer)
    expect(res.status).toBe(403)
    expect(res.body).toBe('forbidden')
  })

  it('still answers 405 for a method other than GET', async () => {
    const route = harness({})
    const res = response()
    await route.handler({ method: 'POST', url: '/extra-paths/resolved?cwd=/' }, res)
    expect(res.status).toBe(405)
  })
})
