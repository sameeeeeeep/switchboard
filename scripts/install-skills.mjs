#!/usr/bin/env node
// Compatibility entry point. The shared operator installer owns installation; no skill copies.
const args = process.argv.slice(2);
if (args.includes('--target')) {
  console.error('Use install-operator.mjs --home <test-home> --no-cli for isolated installs.');
  process.exit(2);
}
const noConnector = !args.includes('--connector');
process.argv = [process.argv[0], process.argv[1], '--client', 'claude',
  ...args.filter(a => !['--connector', '--force'].includes(a)), ...(noConnector ? ['--no-cli'] : [])];
await import('./install-operator.mjs');
