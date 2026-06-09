import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// Ensure localStorage is available in jsdom
if (typeof window !== "undefined" && !window.localStorage) {
  const store: Record<string, string> = {};
  window.localStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach((key) => delete store[key]);
    },
    length: 0,
    key: () => null,
  } as Storage;
}

beforeEach(() => {
  // Clear localStorage before each test
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  }
});

afterEach(() => {
  cleanup();
});
