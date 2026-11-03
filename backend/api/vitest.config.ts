import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    // Opt-in live adapters share one explicitly disposable schema. Serial files
    // prevent unrelated cleanup/foreign-key locks from creating nondeterministic
    // cross-suite deadlocks; the default in-memory suite remains parallel.
    fileParallelism: process.env["MK8DX_MYSQL_INTEGRATION"] !== "1",
  },
});
