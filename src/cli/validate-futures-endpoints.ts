import { loadFuturesEndpointCatalog } from '../config/futures-endpoints';

async function main() {
  const catalog = loadFuturesEndpointCatalog();
  const endpointCount = catalog.endpoints.length;
  // eslint-disable-next-line no-console
  console.log(
    `Validated futures endpoint catalog (${catalog.version}) with ${endpointCount} endpoints`,
  );
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Futures endpoint catalog validation failed: ${msg}\n`);
  process.exit(1);
});
