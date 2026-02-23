import type { ExcalidrawData } from '../types'

// Ein einfacher LRU (Least Recently Used) Cache mit Speicherlimit
export class DrawingCache {
  private cache = new Map<string, { data: ExcalidrawData; size: number }>()
  private currentSize = 0
  private maxSize: number

  constructor(maxSizeMB = 50) {
    // 50 MB in Bytes
    this.maxSize = maxSizeMB * 1024 * 1024
  }

  // Schätzt die Größe der Daten im Speicher (sehr grob: JSON-String-Länge * 2 Bytes pro Zeichen)
  private estimateSize(data: ExcalidrawData): number {
    try {
      return JSON.stringify(data).length * 2
    } catch {
      // Fallback, falls Stringify fehlschlägt (z.B. Zirkelbezüge, die in Excalidraw aber nicht vorkommen sollten)
      return 1024 * 50 // 50 KB Annahme
    }
  }

  get(id: string): ExcalidrawData | undefined {
    if (!this.cache.has(id)) return undefined

    // Element existiert -> Wir holen es
    const item = this.cache.get(id)!
    
    // LRU-Logik: Löschen und neu einfügen, damit es ans Ende der Map (als "kürzlich genutzt") rückt
    this.cache.delete(id)
    this.cache.set(id, item)

    // Deep clone to prevent Excalidraw from mutating the cached data
    try {
      return JSON.parse(JSON.stringify(item.data))
    } catch {
      return item.data
    }
  }

  set(id: string, data: ExcalidrawData): void {
    const size = this.estimateSize(data)

    // Falls das Drawing absurderweise größer als der gesamte Cache ist, gar nicht erst cachen
    if (size > this.maxSize) {
      console.warn(`Drawing ${id} is too large to cache (${Math.round(size / 1024 / 1024)} MB)`)
      return
    }

    // Wenn es schon existiert, alte Größe abziehen
    if (this.cache.has(id)) {
      this.currentSize -= this.cache.get(id)!.size
      this.cache.delete(id)
    }

    // Neues Element zur Größe addieren
    this.currentSize += size
    this.cache.set(id, { data, size })

    // Eviction: Wenn wir über dem Limit sind, werfen wir das älteste (erste) Element raus
    this.evictUntilUnderLimit()
  }

  private evictUntilUnderLimit(): void {
    while (this.currentSize > this.maxSize && this.cache.size > 0) {
      // Map.keys() iteriert in Einfügereihenfolge -> das erste ist das am längsten ungenutzte
      const oldestId = this.cache.keys().next().value
      if (oldestId) {
        const item = this.cache.get(oldestId)!
        this.currentSize -= item.size
        this.cache.delete(oldestId)
        console.debug(`Evicted drawing ${oldestId} from cache to free memory.`)
      }
    }
  }

  clear(): void {
    this.cache.clear()
    this.currentSize = 0
  }
}

// Singleton-Instanz, die über Component-Mounts hinweg existiert
export const drawingCache = new DrawingCache(50)
