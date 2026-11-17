export const MAX_UNDO_STEPS = 30;

export type HistoryEntry<T> = { snapshot: T; empty: boolean };

/** Linear undo/redo stack. Index 0 is the oldest retained state. */
export class History<T> {
  private entries: HistoryEntry<T>[] = [];
  private index = -1;

  constructor(private readonly maxUndo = MAX_UNDO_STEPS) {}

  reset(snapshot: T, empty = true) {
    this.entries = [{ snapshot, empty }];
    this.index = 0;
  }

  commit(snapshot: T, empty: boolean) {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({ snapshot, empty });
    const excess = this.entries.length - (this.maxUndo + 1);
    if (excess > 0) this.entries.splice(0, excess);
    this.index = this.entries.length - 1;
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index >= 0 && this.index < this.entries.length - 1;
  }

  undo(): HistoryEntry<T> | null {
    if (!this.canUndo) return null;
    this.index--;
    return this.entries[this.index];
  }

  redo(): HistoryEntry<T> | null {
    if (!this.canRedo) return null;
    this.index++;
    return this.entries[this.index];
  }
}
