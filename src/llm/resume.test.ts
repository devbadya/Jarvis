import { describe, expect, it } from 'vitest'
import { cacheKeyFor, planWrite, type ResumeMeta } from './resume'

describe('cacheKeyFor', () => {
  it('flattens a download URL into a safe filename', () => {
    expect(
      cacheKeyFor('https://huggingface.co/onnx-community/Model/resolve/main/onnx/model_q4f16.onnx'),
    ).toBe('huggingface.co_onnx-community_Model_resolve_main_onnx_model_q4f16.onnx')
  })

  it('keeps the model id recognisable so cached files can be attributed', () => {
    const key = cacheKeyFor(
      'https://huggingface.co/onnx-community/Qwen3.5-0.8B-Text-ONNX/resolve/main/x.json',
    )
    expect(key).toContain(cacheKeyFor('onnx-community/Qwen3.5-0.8B-Text-ONNX'))
  })

  it('produces distinct keys for distinct URLs', () => {
    expect(cacheKeyFor('https://a.co/x/model.onnx')).not.toBe(cacheKeyFor('https://a.co/y/model.onnx'))
  })

  it('strips characters that are not filename-safe', () => {
    expect(cacheKeyFor('https://host/a?b=c#d')).toBe('host_a_b_c_d')
  })
})

describe('planWrite', () => {
  const meta: ResumeMeta = { etag: '"abc"', total: 1000 }

  it('starts from zero when the whole file arrives', () => {
    expect(
      planWrite({ status: 200, etag: '"abc"', contentRange: null, contentLength: '1000' }, 600, meta),
    ).toEqual({ start: 0, total: 1000 })
  })

  it('continues the partial when the range matches it exactly', () => {
    expect(
      planWrite(
        { status: 206, etag: '"abc"', contentRange: 'bytes 600-999/1000', contentLength: '400' },
        600,
        meta,
      ),
    ).toEqual({ start: 600, total: 1000 })
  })

  it('refuses a range whose entity tag no longer matches the saved bytes', () => {
    expect(
      planWrite(
        { status: 206, etag: '"changed"', contentRange: 'bytes 600-999/1000', contentLength: '400' },
        600,
        meta,
      ),
    ).toBeNull()
  })

  it('refuses a range that belongs to a differently sized file', () => {
    expect(
      planWrite(
        { status: 206, etag: '"abc"', contentRange: 'bytes 600-1199/1200', contentLength: '600' },
        600,
        meta,
      ),
    ).toBeNull()
  })

  it('refuses a range that does not start where the file ends', () => {
    expect(
      planWrite(
        { status: 206, etag: '"abc"', contentRange: 'bytes 500-999/1000', contentLength: '500' },
        600,
        meta,
      ),
    ).toBeNull()
  })

  it('refuses a range nobody asked for, and any other status', () => {
    expect(
      planWrite(
        { status: 206, etag: '"abc"', contentRange: 'bytes 0-999/1000', contentLength: '1000' },
        0,
        null,
      ),
    ).toBeNull()
    expect(
      planWrite({ status: 404, etag: null, contentRange: null, contentLength: null }, 0, null),
    ).toBeNull()
  })
})
