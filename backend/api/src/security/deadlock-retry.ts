const DEADLOCK_ATTEMPTS = 4;

/**
 * Runs one autocommit statement again when InnoDB chose it as a deadlock victim (bounded, short
 * jitter). A deadlock rolls the victim's whole transaction back, so for a single autocommit
 * statement nothing of it was applied and running it again cannot count anything twice.
 */
export async function retryOnDeadlock<T>(statement: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await statement();
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code !== "ER_LOCK_DEADLOCK" || attempt >= DEADLOCK_ATTEMPTS) { throw error; }
      await new Promise((resolve) => { setTimeout(resolve, Math.floor(Math.random() * 20 * attempt)); });
    }
  }
}
