# TanStack Table & URL State Sync Guide

This guide establishes the pattern for building high-performance data tables with synchronized URL search parameters using **TanStack Table (`@tanstack/react-table`)** and **`nuqs`**, based on **OpenStatus (`openstatusHQ/openstatus`)**.

---

## 1. Why URL State Synchronization Matters

In dashboards and SaaS applications, table pagination, active filters, search queries, and column sorting should be stored in the URL (`?page=2&sort=created_at.desc&search=active`). This guarantees:

1. Users can share exact table views via copied URLs.
2. Browser Back/Forward buttons navigate through filter states correctly.
3. Server Components can read initial search params to pre-render the exact filtered data without client layout shifts.

---

## 2. Defining Type-Safe Query Parsers with `nuqs`

```typescript
import {
  createSearchParamsCache,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
} from 'nuqs/server';

export const tableSearchParams = {
  page: parseAsInteger.withDefault(1),
  limit: parseAsInteger.withDefault(20),
  search: parseAsString.withDefault(''),
  status: parseAsStringEnum(['active', 'archived', 'draft']).withDefault('active'),
  sort: parseAsString.withDefault('createdAt.desc'),
};

export const searchParamsCache = createSearchParamsCache(tableSearchParams);
```

---

## 3. Client Hook Wiring TanStack Table to `nuqs`

```typescript
'use client';

import { useQueryStates } from 'nuqs';
import {
  useReactTable,
  getCoreRowModel,
  ColumnDef,
  PaginationState,
  SortingState,
} from '@tanstack/react-table';
import { tableSearchParams } from './searchParams';

export function useUrlSyncedTable<TData>({
  data,
  columns,
  totalRows,
}: {
  data: TData[];
  columns: ColumnDef<TData>[];
  totalRows: number;
}) {
  const [params, setParams] = useQueryStates(tableSearchParams, {
    shallow: false, // Triggers server-side RSC re-fetch
  });

  const pagination: PaginationState = {
    pageIndex: params.page - 1,
    pageSize: params.limit,
  };

  const table = useReactTable({
    data,
    columns,
    pageCount: Math.ceil(totalRows / params.limit),
    state: {
      pagination,
    },
    manualPagination: true,
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater(pagination) : updater;
      setParams({
        page: next.pageIndex + 1,
        limit: next.pageSize,
      });
    },
    getCoreRowModel: getCoreRowModel(),
  });

  return { table, params, setParams };
}
```
