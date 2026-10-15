/**
 * Feasibility spike for the `internal/get` service-wrap approach.
 *
 * Runs against the cordis copy the RUNNING dsh app (0.1.5-rc.1) ships, but never
 * boots dsh itself: a root Context plus three throwaway plugins.
 *
 * Questions this must answer with evidence, not with source reading:
 *   Q1 does a listener on `internal/get` fire for an ordinary `ctx.foo` read?
 *   Q2 does it fire for a read issued from inside another service via `this.ctx.foo`?
 *   Q3 is the wrapped value returned to the reader, and is wrapper identity stable?
 *   Q4 does a Proxy wrapper keep getters, methods, `this`-state, and `instanceof` intact?
 *   Q5 does a read through `ctx.get('foo')` bypass the listener (documented gap)?
 *   Q6 does a missing-service read still fail exactly as before while the listener is installed?
 *   Q7 what does a listener that returns without calling next() do (short-circuit semantics)?
 */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Resolve the RUNNING app's install dir instead of pinning one machine's path:
//   DSH_APP_DIR=/path/to/@deepseek-ai/dsh node spike/…
const DSH_APP = process.env.DSH_APP_DIR
  ?? `${execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()}/@deepseek-ai/dsh`
const cordis = await import(pathToFileURL(`${DSH_APP}/node_modules/@deepseek-ai/cordis/lib/index.js`).href)
const { Context, Service } = cordis

const results = []
const check = (id, ok, detail) => {
  results.push({ id, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} :: ${detail}`)
}

// ---------------------------------------------------------------- fixtures

class FooService extends Service {
  constructor(ctx) {
    super(ctx, 'foo')
    this.calls = 0
  }
  get label() { return `foo#${this.calls}` }
  hello() { this.calls += 1; return `hello:${this.calls}` }
}

/** Reads `foo` through its OWN service context — the in-tree consumer pattern. */
class BarService extends Service {
  constructor(ctx) { super(ctx, 'bar') }
  readViaOwnCtx() { return this.ctx.foo.hello() }
}

// ---------------------------------------------------------------- harness

const wrappedOf = new WeakMap()
let listenerFired = 0
const wrapCounts = new Map()

function wrap(inner, tag) {
  wrapCounts.set(tag, (wrapCounts.get(tag) ?? 0) + 1)
  const bound = new Map()
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop === 'hello' && tag === 'foo') {
        return () => `wrapped:${target.hello()}`
      }
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      let fn = bound.get(prop)
      if (fn === undefined) { fn = value.bind(target); bound.set(prop, fn) }
      return fn
    },
  })
}

class ProviderPlugin { constructor(ctx) { new FooService(ctx); new BarService(ctx) } }

class WrapPlugin {
  constructor(ctx) {
    ctx.on('internal/get', (readCtx, name, error, next) => {
      listenerFired += 1
      const value = next()
      if ((name !== 'foo' && name !== 'sandbox' && name !== 'fs') || value === null || typeof value !== 'object') return value
      let wrapper = wrappedOf.get(value)
      if (wrapper === undefined) { wrapper = wrap(value, name); wrappedOf.set(value, wrapper) }
      return wrapper
    })
  }
}

/**
 * Records what a sibling plugin sees when it reads through the proxy.
 * `static inject` is mandatory: a fiber's store only holds its OWN injected
 * dependencies, so an undeclared `ctx.foo` read throws "without inject" — this
 * is exactly why bash-sandbox declares `static inject = ['sandbox', ...]`.
 */
class ConsumerPlugin {
  static inject = ['foo', 'bar']
  constructor(ctx) { this.ctx = ctx; this.seen = {}; consumerSeen = this.probe() }
  probe() {
    const first = this.ctx.foo
    const second = this.ctx.foo
    this.seen.sameIdentity = first === second
    this.seen.isFoo = first instanceof FooService
    this.seen.getter = first.label
    this.seen.method = first.hello()
    this.seen.afterMethodGetter = first.label
    this.seen.destructured = (({ hello }) => hello())(first)
    this.seen.viaOwnCtx = this.ctx.bar.readViaOwnCtx()
    this.seen.viaReflectGet = this.ctx.get('foo').hello()
    return this.seen
  }
}

// ---------------------------------------------------------------- run

const root = new Context()
await root.plugin(ProviderPlugin)
await root.plugin(WrapPlugin)
// A root-scope sibling entry, exactly like tool-fs / bash-sandbox: it declares
// its injections and only then may read them.
let consumerCtxSeen
let consumerSeen
await root.plugin((ctx) => { consumerCtxSeen = ctx })
await root.plugin(ConsumerPlugin)

const before = listenerFired
const seen = consumerSeen

check('Q1 listener fires on an ordinary ctx.foo read', listenerFired > before, `listenerFired ${before} -> ${listenerFired}`)
check('Q2 listener fires for a read issued inside another service (this.ctx.foo)', String(seen.viaOwnCtx).startsWith('wrapped:'), `bar.readViaOwnCtx() = ${seen.viaOwnCtx}`)
check('Q3 wrapped value reaches the reader', String(seen.method).startsWith('wrapped:'), `foo.hello() = ${seen.method}`)
check('Q3 wrapper identity is stable across reads', seen.sameIdentity === true, `ctx.foo === ctx.foo -> ${seen.sameIdentity}`)
check('Q4 getter runs on the inner instance and sees inner state', seen.getter === 'foo#1', `label after one hello = ${seen.getter} (expect foo#1)`)
check('Q4 own-field mutation lands on the inner instance', seen.afterMethodGetter === 'foo#2', `label after two hellos = ${seen.afterMethodGetter} (expect foo#2)`)
check('Q4 destructured method still works', String(seen.destructured).startsWith('wrapped:'), `const {hello}=foo; hello() = ${seen.destructured}`)
check('Q4 instanceof survives the Proxy', seen.isFoo === true, `foo instanceof FooService -> ${seen.isFoo}`)

const bypassed = !String(seen.viaReflectGet).startsWith('wrapped:')
check('Q5 ctx.get(name) bypasses internal/get (known gap, must be documented)', bypassed, `ctx.get('foo').hello() = ${seen.viaReflectGet}`)

let missingError = null
try { void consumerCtxSeen.definitelyNotAService } catch (error) { missingError = error }
check('Q6 missing-service read still throws', missingError !== null, `threw: ${missingError?.message}`)

let shortCircuit = null
const root2 = new Context()
await root2.plugin(ProviderPlugin)
await root2.plugin((ctx) => {
  ctx.on('internal/get', (readCtx, name, error, next) => (name === 'foo' ? 'HIJACKED' : next()))
})
await root2.plugin((ctx) => { shortCircuit = ctx.foo })
check('Q7 a listener that skips next() replaces the value outright', shortCircuit === 'HIJACKED', `ctx.foo -> ${String(shortCircuit)}`)

console.log('\nwrap invocations by service:', JSON.stringify(Object.fromEntries(wrapCounts)))
console.log('total listener invocations:', listenerFired)
console.log('\nSUMMARY', results.every(r => r.ok) ? 'ALL PASS' : `FAILURES: ${results.filter(r => !r.ok).map(r => r.id).join(', ')}`)
process.exit(results.every(r => r.ok) ? 0 : 1)
