// 「過了多久」的中文說法：用在等待時間這類只需要大概感覺的地方
// now 從外面傳進來（預設是現在），跟規則引擎一樣，方便測試固定時間
export function elapsed(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return '剛剛'
  if (minutes < 60) return `${minutes} 分鐘`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小時`
  return `${Math.floor(hours / 24)} 天`
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', { hour12: false })
}
