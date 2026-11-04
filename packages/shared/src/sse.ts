// SSE（Server-Sent Events）的格式很簡單，每則訊息長這樣，以「空一行」結尾：
//
//   data: {"type":"finding", ...}
//   (空行)
//
// 以冒號開頭的行是註解，常用來當心跳（keep-alive），收到直接忽略。
//
// 麻煩的是網路不會照「一則訊息」切給你：一次收到的資料可能是半則、也可能是三則半，
// 所以要自己把收到的文字累積起來，遇到空行才切出一則完整的訊息。

export function createSseParser(onMessage: (data: string) => void) {
  let buffer = ''

  return function feed(chunk: string) {
    buffer += chunk.replace(/\r\n/g, '\n')

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      const data = raw
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n')
      if (data) onMessage(data)

      boundary = buffer.indexOf('\n\n')
    }
  }
}
