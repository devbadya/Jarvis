import { describe, expect, it } from 'vitest'
import { cacheKeyFor } from './opfs-cache'

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
