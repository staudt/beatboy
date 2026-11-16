/** Collects warnings and the confidence penalties that go with them (each penalty key counts once). */
export class Notes {
  readonly warnings: string[] = [];
  private readonly penalties = new Map<string, number>();

  /** Adds a warning once (same text = same warning). `penalty` lowers the confidence; `key` merges penalties of one kind. */
  add(message: string, penalty = 0, key: string = message): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
    if (penalty > 0) this.penalties.set(key, Math.max(this.penalties.get(key) ?? 0, penalty));
  }

  /** Penalty without a warning text. */
  penalise(key: string, penalty: number): void {
    this.penalties.set(key, Math.max(this.penalties.get(key) ?? 0, penalty));
  }

  /** 1 minus all penalties, rounded to two decimals, never below 0.05. */
  confidence(): number {
    let c = 1;
    for (const p of this.penalties.values()) c -= p;
    return Math.round(Math.min(1, Math.max(0.05, c)) * 100) / 100;
  }
}
