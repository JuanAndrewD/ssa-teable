# The web-app

You don't need start this app when developing locally, it's started by the `nestjs-backend`.

all env is maintained in the .env\* file, it is shared with the backend.

## Conditional lookup sort and limit

Enabling sort/limit leaves the limit blank: sorting alone must not add a numeric limit to
the saved options. Blank uses the configured conditional-query default cap; an explicit
limit updates the matching-record hint immediately. Disabling clears both sort and limit.
The shared conditional-rollup control follows the same interaction contract.

Run the focused interaction coverage with:

```sh
pnpm --filter @teable/app exec vitest run src/features/app/components/field-setting/options/LinkedRecordSortLimitConfig.spec.tsx
```
