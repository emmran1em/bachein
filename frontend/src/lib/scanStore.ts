/** Cross-screen hand-off of scanned pages (scanner → create flow). */
let pending: string[] = [];

export const scanStore = {
  set(pages: string[]) { pending = pages; },
  consume(): string[] { const p = pending; pending = []; return p; },
};
