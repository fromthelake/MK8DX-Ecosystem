import { expect, test } from "vitest";
import { supportedDatabase } from "../src/composition/external-database-check-main.js";

test("accepts supported MariaDB/MySQL lines and rejects XAMPP 10.4", () => {
  expect(supportedDatabase("11.4.13-MariaDB")).toBe("MariaDB");
  expect(supportedDatabase("8.4.11")).toBe("MySQL");
  expect(supportedDatabase("9.7.4")).toBe("MySQL");
  expect(supportedDatabase("26.10.0")).toBe("MySQL");
  expect(() => supportedDatabase("10.4.32-MariaDB")).toThrow("11.4");
  expect(() => supportedDatabase("8.0.44")).toThrow("8.4");
});
