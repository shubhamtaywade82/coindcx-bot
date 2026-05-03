const DEFAULT_TEST_ENV: Record<string, string> = {
  SKIP_DOCKER_TESTS: '1',
  PG_URL: 'postgres://bot:bot@localhost:5432/coindcx_bot',
  COINDCX_API_KEY: 'local-dev-key',
  COINDCX_API_SECRET: 'local-dev-secret',
  LOG_DIR: './logs',
};

for (const [key, value] of Object.entries(DEFAULT_TEST_ENV)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
