/**
 * Feasibility spike #3: is an outer Proxy wrapper TRANSPARENT to cordis semantics?
 *
 * Measures the same observations twice on identical contexts — once with no
 * listener (BASELINE = stock cordis) and once with an `internal/get` listener
 * that wraps the service (WRAPPED). A difference that is not explicitly
 * designed for is a transparency bug in the wrapper.
 *
 * Runs against the cordis copy shipped inside the RUNNING dsh app (0.1.5-rc.1).
 */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Resolve the RUNNING app's install dir instead of pinning one machine's path:
//   DSH_APP_DIR=/path/to/@deepseek-ai/dsh node spike/…
const DSH_APP = process.env.DSH_APP_DIR
  ?? `${execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()}/@deepseek-ai/dsh`
const { Context, Service } = await import(pathToFileURL(`${DSH_APP}/node_modules/@deepseek-ai/cordis/lib/index.js`).href)

// ---------------------------------------------------------------- fixtures

const SHADOW = Symbol.for('cordis.shadow')

class FooService extends Service {
  constructor(ctx) {
    super(ctx, 'foo')
    this.calls = 0
  }
  get label() { return `foo#${this.calls}` }
  hello() { this.calls += 1; return `hello:${this.calls}` }
  /**
   * `this.ctx` inside a method must be the READER's context extended with a
   * shadow pointing at the service's origin ctx — that shadow is what makes
   * `this.ctx.<sibling>` resolve inside a service method.
   */
  readerTag() { return this.ctx?.[SHADOW] === undefined ? 'no-shadow' : 'has-shadow' }
  readerCtxIsUsable() { return typeof this.ctx?.foo === 'object' ? 'usable' : 'unusable' }
}

class BarService extends Service {
  constructor(ctx) { super(ctx, 'bar') }
  /** The in-tree consumer pattern: a service method reading a sibling service. */
  readViaOwnCtx() { return this.ctx.foo.hello() }
}

class ProviderPlugin { constructor(ctx) { new FooService(ctx); new BarService(ctx) } }

function wrapService(inner) {
  const bound = new Map()
  return new Proxy(inner, {
    get(target, prop) {
      if (prop === 'hello') return () => `wrapped(${target.hello()})`
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function' || prop === 'constructor') return value
      let fn = bound.get(prop)
      if (fn === undefined) { fn = value.bind(target); bound.set(prop, fn) }
      return fn
    },
  })
}

class WrapPlugin {
  constructor(ctx) {
    this.wraps = 0
    ctx.on('internal/get', (readCtx, name, error, next) => {
      const value = next()
      if (name !== 'foo' || value === null || typeof value !== 'object') return value
      this.wraps += 1
      return wrapService(value)
    })
  }
}

// ---------------------------------------------------------------- observation

async function boot({ wrap }) {
  const root = new Context()
  root.tag = 'root-ctx'
  await root.plugin(ProviderPlugin)
  let wrapPlugin
  if (wrap) {
    class Recorder extends WrapPlugin { constructor(ctx) { super(ctx); wrapPlugin = this } }
    await root.plugin(Recorder)
  }
  let observed
  class ConsumerPlugin {
    static inject = ['foo', 'bar']
    constructor(ctx) {
      const a = ctx.foo
      const b = ctx.foo
      const identityStable = a === b
      const constructorName = a.constructor?.name ?? 'none'
      const instanceOfService = a instanceof Service
      const instanceOfFoo = a instanceof FooService
      const labelBefore = a.label
      const helloReturn = a.hello()
      const labelAfter = a.label
      const readerTag = a.readerTag()
      const readerCtxUsable = a.readerCtxIsUsable()
      const ownCtxReads = ctx.bar.readViaOwnCtx()
      const reflectGet = ctx.get('foo').hello()
      observed = {
        identityStable, constructorName, instanceOfService, instanceOfFoo,
        labelBefore, helloReturn, labelAfter, readerTag, readerCtxUsable, ownCtxReads,
        reflectGetBypassesListener: !String(reflectGet).startsWith('wrapped('),
        ownCtxReadIsWrapped: String(ownCtxReads).startsWith('wrapped('),
      }
    }
  }
  await root.plugin(ConsumerPlugin)
  return { observed, wrapPlugin }
}

const baseline = await boot({ wrap: false })
const wrapped = await boot({ wrap: true })

const keys = Object.keys(baseline.observed)
const width = Math.max(...keys.map(k => k.length)) + 1
console.log('observation'.padEnd(width), '| BASELINE (stock cordis)'.padEnd(30), '| WRAPPED', '| verdict')
console.log('-'.repeat(110))
for (const key of keys) {
  const a = String(baseline.observed[key])
  const b = String(wrapped.observed[key])
  const same = a === b
  const intended = key === 'helloReturn' || key === 'ownCtxReads' || key === 'labelBefore' || key === 'labelAfter'
  const verdict = same ? 'same' : intended ? 'intended (the wrapped method)' : 'DIFFERS'
  console.log(key.padEnd(width), '|', a.padEnd(28), '|', b.padEnd(22), '|', verdict)
}

console.log('\nlistener wrap invocations:', wrapped.wrapPlugin?.wraps ?? 0)
console.log('stock identity note: ctx.foo === ctx.foo is', baseline.observed.identityStable, 'without any listener (getTraceable creates a fresh proxy per read)')

// A stock cordis limitation worth recording: an unbound method reference loses `this`.
let destructuredOutcome
try {
  const root = new Context()
  await root.plugin(ProviderPlugin)
  class C { static inject = ['foo']; constructor(ctx) { const { hello } = ctx.foo; destructuredOutcome = hello() } }
  await root.plugin(C)
} catch (error) { destructuredOutcome = `THROWS: ${error.message}` }
console.log('stock cordis, destructured method call:', destructuredOutcome)
