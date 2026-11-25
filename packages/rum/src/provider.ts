/**
 * The web tracer provider on the spike-proven 2.x line (findings F1/F2/F3): the web SDK
 * has no 3.x release, so this package keeps its own dependency surface away from the
 * server's SDK 3.x / api 1.10.0 tree.
 */
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import type { RumConfig } from "./config.ts";
import { createRumExporter } from "./exporter.ts";
import { ScrubProcessor } from "./scrub.ts";

export function createRumProvider(config: RumConfig): WebTracerProvider {
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      "service.name": config.serviceName,
      // RUM only boots in production builds (D-209), so the environment is a constant.
      "deployment.environment.name": "production",
      ...(config.deploymentId === null ? {} : { "deployment.id": config.deploymentId }),
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampling) }),
    spanProcessors: [
      // Scrub first: the batch processor queues the same span object the scrub rewrote.
      new ScrubProcessor(),
      // 2.x constructor form (exporter, config) — the spike's proven shape. The options
      // object is the 3.x API; on 2.x it would leave the exporter unset and silently drop
      // every span (the failure spike F3 warns about, mirrored across the two lines).
      new BatchSpanProcessor(createRumExporter(config), {
        maxQueueSize: 256,
        maxExportBatchSize: 64,
        scheduledDelayMillis: 5000,
      }),
    ],
  });
  // 2.x convenience registration (spike F2): 3.x removed register(); we are on the web 2.x
  // line, and ZoneContextManager keeps the context across the fetch/XHR async boundaries.
  provider.register({ contextManager: new ZoneContextManager() });
  return provider;
}
