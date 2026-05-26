const DB_NAME = 'halfmann-trending'
const STORE_NAME = 'samples'
const DB_VERSION = 1

function canUseIndexedDb() {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      resolve(null)
      return
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'timestampMs' })
        store.createIndex('timestampMs', 'timestampMs', { unique: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

export async function loadSnapshotsSince(cutoffMs) {
  const db = await openDb()
  if (!db) return []

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const range = window.IDBKeyRange.lowerBound(cutoffMs)
    const request = store.openCursor(range)
    const rows = []

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      rows.push(cursor.value)
      cursor.continue()
    }

    tx.oncomplete = () => {
      rows.sort((a, b) => a.timestampMs - b.timestampMs)
      resolve(rows)
    }
    tx.onerror = () => reject(tx.error)
  })
}

export async function saveSnapshot(snapshot) {
  const db = await openDb()
  if (!db) return

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(snapshot)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function pruneSnapshotsBefore(cutoffMs) {
  const db = await openDb()
  if (!db) return

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const range = window.IDBKeyRange.upperBound(cutoffMs - 1)
    const request = store.openCursor(range)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      cursor.delete()
      cursor.continue()
    }

    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
