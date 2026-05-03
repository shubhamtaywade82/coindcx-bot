import { readFuturesEndpointCatalog } from '../config/futures-endpoints';

async function main() {
  const catalog = readFuturesEndpointCatalog();
  const endpointCount = Object.values(catalog.endpoints).reduce(
    (sum, section) => sum + section.length,
    0,
  );
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
