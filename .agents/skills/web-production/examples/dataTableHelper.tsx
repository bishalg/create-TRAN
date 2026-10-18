'use client';

import {
  useReactTable,
  getCoreRowModel,
  ColumnDef,
  PaginationState,
  RowSelectionState,
} from '@tanstack/react-table';
import { useQueryStates, parseAsInteger, parseAsString } from 'nuqs';
import { useState } from 'react';

export const defaultTableParams = {
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(20),
  search: parseAsString.withDefault(''),
  sort: parseAsString.withDefault('createdAt.desc'),
};

/**
 * Reusable client hook binding TanStack Table state directly to URL search params via `nuqs`.
 * Inspired by `openstatusHQ/openstatus`.
 */
export function useUrlSyncedDataTable<TData>({
  data,
  columns,
  totalRows,
}: {
  data: TData[];
  columns: ColumnDef<TData>[];
  totalRows: number;
}) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [params, setParams] = useQueryStates(defaultTableParams, {
    shallow: false,
  });

  const pagination: PaginationState = {
    pageIndex: params.page - 1,
    pageSize: params.pageSize,
  };

  const table = useReactTable({
    data,
    columns,
    pageCount: Math.ceil(totalRows / params.pageSize),
    state: {
      pagination,
      rowSelection,
    },
    manualPagination: true,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater(pagination) : updater;
      setParams({
        page: next.pageIndex + 1,
        pageSize: next.pageSize,
      });
    },
    getCoreRowModel: getCoreRowModel(),
  });

  return {
    table,
    params,
    setParams,
    selectedRows: table.getSelectedRowModel().rows.map((r) => r.original),
  };
}
