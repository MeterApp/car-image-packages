# Car Image SDK and CLI

The MIT-licensed TypeScript SDK and command-line client for Car Image. This repository is the source for both packages.

| Package | Install | Guide |
| --- | --- | --- |
| `@meterapp/car-image-sdk` | `npm install @meterapp/car-image-sdk` | [SDK](packages/sdk/README.md) |
| `@meterapp/car-image` | `npx @meterapp/car-image --help` | [CLI](packages/cli/README.md) |

Use Node 26 and the pnpm version in `package.json` for development:

```sh
pnpm install --frozen-lockfile
pnpm check
```

The checks build the packages with TypeScript and run the tests. They do not need a live API or credentials.

Report potential vulnerabilities privately to support@carimage.dev.
