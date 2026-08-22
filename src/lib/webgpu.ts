export interface GpuCapability {
  supported: boolean
  reason?: string
  adapter?: string
  /** Largest buffer the adapter will allocate; the 0.8B weights need roughly 512 MB. */
  maxBufferSizeMb?: number
}

/**
 * Feature-detects WebGPU before the worker tries to load half a gigabyte of weights,
 * so unsupported browsers get an explanation instead of a stack trace.
 */
export async function detectWebGpu(): Promise<GpuCapability> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return {
      supported: false,
      reason:
        'This browser does not expose the WebGPU API. Chrome or Edge 113+ is required; Safari and Firefox still ship it behind a flag.',
    }
  }

  try {
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      return {
        supported: false,
        reason:
          'WebGPU is present but no GPU adapter was returned. On Linux or in a VM, hardware acceleration may be disabled.',
      }
    }
    const info: GPUAdapterInfo | undefined = adapter.info
    return {
      supported: true,
      adapter: [info?.vendor, info?.architecture].filter(Boolean).join(' ') || undefined,
      maxBufferSizeMb: Math.round(adapter.limits.maxBufferSize / (1024 * 1024)),
    }
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : 'WebGPU initialisation failed.',
    }
  }
}
