import { loadFuturesEndpointSpec, validateFuturesEndpointSpec } from '../config/futures-endpoints';

async function main() {
  const spec = loadFuturesEndpointSpec();
  const issues = validateFuturesEndpointSpec(spec);
  if (issues.length > 0) {
    throw new Error(issues.join('; '));
  }
  const endpointCount = spec.endpoints.length;
  // eslint-disable-next-line no-console
  console.log(
    `Validated futures endpoint spec (v${spec.catalogVersion}) with ${endpointCount} endpoints`,
  );
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Futures endpoint catalog validation failed: ${msg}\n`);
  process.exit(1);
});
