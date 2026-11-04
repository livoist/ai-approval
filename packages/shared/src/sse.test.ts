import { describe, expect, it } from 'vitest'
import { createSseParser } from './sse'

function collect() {
  const messages: string[] = []
  return { messages, feed: createSseParser((m) => messages.push(m)) }
}

describe('createSseParser', () => {
  it('一次收到完整的一則訊息', () => {
    const { messages, feed } = collect()
    feed('data: {"a":1}\n\n')
    expect(messages).toEqual(['{"a":1}'])
  })

  it('訊息被切成好幾段送達，要等到空行才輸出', () => {
    const { messages, feed } = collect()
    feed('data: {"a"')
    feed(':1}')
    expect(messages).toEqual([])
    feed('\n\n')
    expect(messages).toEqual(['{"a":1}'])
  })

  it('一次收到好幾則訊息', () => {
    const { messages, feed } = collect()
    feed('data: 1\n\ndata: 2\n\ndata: 3')
    expect(messages).toEqual(['1', '2'])
    feed('\n\n')
    expect(messages).toEqual(['1', '2', '3'])
  })

  it('忽略心跳註解', () => {
    const { messages, feed } = collect()
    feed(': ping\n\ndata: ok\n\n')
    expect(messages).toEqual(['ok'])
  })
})
