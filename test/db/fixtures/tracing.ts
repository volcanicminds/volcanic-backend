//
// An in-memory OpenTelemetry SDK, registered the way an SDK started with `--import` registers:
// provider, context manager and propagator, with the finished spans kept in an array.
//
// Installed and removed by each suite that uses it: the API's globals belong to the whole mocha
// process, and a provider left behind would trace every suite that runs after.
//
import { context, metrics, propagation, trace } from '@opentelemetry/api'
import { node, tracing } from '@opentelemetry/sdk-node'

export function installTracing() {
  const exporter = new tracing.InMemorySpanExporter()
  const provider = new node.NodeTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(exporter)] })
  provider.register()
  return {
    spans: () => exporter.getFinishedSpans(),
    reset: () => exporter.reset(),
    async uninstall() {
      await provider.shutdown()
      trace.disable()
      context.disable()
      propagation.disable()
      metrics.disable()
    }
  }
}
