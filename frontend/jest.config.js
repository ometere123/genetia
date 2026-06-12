/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Run jest.setup.ts before each test module is loaded so env vars are set
  // before resolver-pipeline.ts reads them at module scope.
  setupFiles: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    // Neutralise Next.js server-only guard.
    "^server-only$": "<rootDir>/src/__mocks__/server-only.ts",
    // Mirror tsconfig paths @/* → src/*.
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          noEmit: false,
          jsx: "react-jsx",
        },
      },
    ],
  },
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  collectCoverageFrom: ["src/lib/**/*.ts", "!src/lib/**/*.d.ts"],
};

module.exports = config;
