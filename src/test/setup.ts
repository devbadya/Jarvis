import '@testing-library/jest-dom/vitest'
// jsdom implements no IndexedDB at all, so `src/memory/db.ts` would take its
// "not available" path and every memory test would pass against nothing. This
// is a real implementation of the API over an in-memory store.
import 'fake-indexeddb/auto'
