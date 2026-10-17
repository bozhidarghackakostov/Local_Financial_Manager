import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../../services/apiClient.js';
import type {
  Account,
  AppSettings,
  Category,
  PaginatedTransactions,
  TransactionRecord,
  TransactionType,
} from '../../../shared/types/index.js';
import { formatDisplayDate } from '../../../shared/utils/dates.js';
import { PageHeader } from '../../components/layout/Sidebar.js';
import {
  AlertBanner,
  EmptyState,
  SignedAmountCell,
  TransactionTypeBadge,
} from '../../components/feedback/Feedback.js';
import { ConfirmDialog, Modal } from '../../components/dialogs/Modal.js';
import { TransactionModal } from './TransactionModal.js';

interface TransactionsViewProps {
  settings: AppSettings;
  accounts: Account[];
  categories: Category[];
  initialCategoryId?: string;
  initialAccountId?: string;
  refreshTrigger: number;
  onDataMutated: () => void;
  onOpenCsvImport: () => void;
}

export const TransactionsView: React.FC<TransactionsViewProps> = ({
  settings,
  accounts,
  categories,
  initialCategoryId,
  initialAccountId,
  refreshTrigger,
  onDataMutated,
  onOpenCsvImport,
}) => {
  const [search, setSearch] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<TransactionType | ''>('');
  const [accountFilter, setAccountFilter] = useState<string>(initialAccountId ?? '');
  const [categoryFilter, setCategoryFilter] = useState<string>(initialCategoryId ?? '');
  const [statusFilter, setStatusFilter] = useState<'active' | 'trashed' | 'all'>('active');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'account' | 'category' | 'updated_at'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(25);

  const [data, setData] = useState<PaginatedTransactions | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [editingTx, setEditingTx] = useState<TransactionRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [viewingTx, setViewingTx] = useState<TransactionRecord | null>(null);
  const [confirmDeleteTx, setConfirmDeleteTx] = useState<{
    tx: TransactionRecord;
    permanent: boolean;
  } | null>(null);

  useEffect(() => {
    if (initialCategoryId !== undefined) {
      setCategoryFilter(initialCategoryId);
      setPage(1);
    }
  }, [initialCategoryId]);

  useEffect(() => {
    if (initialAccountId !== undefined) {
      setAccountFilter(initialAccountId);
      setPage(1);
    }
  }, [initialAccountId]);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getTransactions({
        search: search || undefined,
        type: typeFilter || undefined,
        accountId: accountFilter || undefined,
        categoryId: categoryFilter || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        status: statusFilter,
        sortBy,
        sortOrder,
        page,
        pageSize,
      });
      setData(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [
    search,
    typeFilter,
    accountFilter,
    categoryFilter,
    startDate,
    endDate,
    statusFilter,
    sortBy,
    sortOrder,
    page,
    pageSize,
  ]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions, refreshTrigger]);

  const handleDuplicate = async (tx: TransactionRecord) => {
    try {
      await apiClient.duplicateTransaction(tx.id);
      setFeedback(`Duplicated transaction "${tx.description || tx.id}" as a new entry.`);
      onDataMutated();
      void loadTransactions();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRestore = async (tx: TransactionRecord) => {
    try {
      await apiClient.restoreTransaction(tx.id);
      setFeedback(`Restored transaction "${tx.description || tx.id}" to the active ledger.`);
      onDataMutated();
      void loadTransactions();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleConfirmedDelete = async () => {
    if (!confirmDeleteTx) return;
    try {
      await apiClient.deleteTransaction(confirmDeleteTx.tx.id, confirmDeleteTx.permanent);
      setFeedback(
        confirmDeleteTx.permanent
          ? 'Transaction permanently deleted.'
          : 'Transaction moved to trash. You can restore it by filtering Status: Trash.'
      );
      setConfirmDeleteTx(null);
      onDataMutated();
      void loadTransactions();
    } catch (err) {
      setError((err as Error).message);
      setConfirmDeleteTx(null);
    }
  };

  const handleResetFilters = () => {
    setSearch('');
    setTypeFilter('');
    setAccountFilter('');
    setCategoryFilter('');
    setStartDate('');
    setEndDate('');
    setStatusFilter('active');
    setSortBy('date');
    setSortOrder('desc');
    setPage(1);
  };

  const buildCsvExportUrl = () => {
    const sp = new URLSearchParams();
    if (typeFilter) sp.set('type', typeFilter);
    if (accountFilter) sp.set('accountId', accountFilter);
    if (categoryFilter) sp.set('categoryId', categoryFilter);
    if (startDate) sp.set('startDate', startDate);
    if (endDate) sp.set('endDate', endDate);
    const qs = sp.toString();
    return `/api/export/transactions.csv${qs ? `?${qs}` : ''}`;
  };

  return (
    <div>
      <PageHeader
        title="Transactions Ledger"
        description="Complete record of income, expenses, refunds, and inter-account transfers."
        actions={
          <>
            <a href={buildCsvExportUrl()} className="btn" download>
              Export CSV
            </a>
            <button type="button" className="btn" onClick={onOpenCsvImport}>
              Import CSV
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditingTx(null);
                setIsModalOpen(true);
              }}
            >
              + New Transaction
            </button>
          </>
        }
      />

      {error && <AlertBanner type="error" message={error} onDismiss={() => setError(null)} />}
      {feedback && (
        <AlertBanner type="success" message={feedback} onDismiss={() => setFeedback(null)} />
      )}

      <div className="panel">
        <div className="filter-bar">
          <div className="form-group" style={{ marginBottom: 0, minWidth: '180px', flex: 1 }}>
            <label htmlFor="filter-search">Search</label>
            <input
              id="filter-search"
              type="search"
              className="form-control"
              placeholder="Merchant, notes, tag..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-type">Type</label>
            <select
              id="filter-type"
              className="form-control"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value as TransactionType | '');
                setPage(1);
              }}
            >
              <option value="">All Types</option>
              <option value="income">Income (+)</option>
              <option value="expense">Expense (-)</option>
              <option value="transfer">Transfer (⇄)</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-account">Account</label>
            <select
              id="filter-account"
              className="form-control"
              value={accountFilter}
              onChange={(e) => {
                setAccountFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-category">Category</label>
            <select
              id="filter-category"
              className="form-control"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.category_type})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-start">From Date</label>
            <input
              id="filter-start"
              type="date"
              className="form-control"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-end">To Date</label>
            <input
              id="filter-end"
              type="date"
              className="form-control"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-status">Status</label>
            <select
              id="filter-status"
              className="form-control"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as 'active' | 'trashed' | 'all');
                setPage(1);
              }}
            >
              <option value="active">Active Ledger</option>
              <option value="trashed">Trash (Deleted)</option>
              <option value="all">All Records</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-sort">Sort By</label>
            <div style={{ display: 'flex', gap: '4px' }}>
              <select
                id="filter-sort"
                className="form-control"
                value={sortBy}
                onChange={(e) =>
                  setSortBy(
                    e.target.value as 'date' | 'amount' | 'account' | 'category' | 'updated_at'
                  )
                }
              >
                <option value="date">Date</option>
                <option value="amount">Amount</option>
                <option value="account">Account</option>
                <option value="category">Category</option>
                <option value="updated_at">Last Updated</option>
              </select>
              <button
                type="button"
                className="btn"
                onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                title="Toggle Sort Direction"
              >
                {sortOrder === 'asc' ? '↑ Asc' : '↓ Desc'}
              </button>
            </div>
          </div>

          <button type="button" className="btn" onClick={handleResetFilters}>
            Reset
          </button>
        </div>

        <div className="table-wrapper">
          {loading && !data ? (
            <div style={{ padding: '20px' }}>Loading transactions...</div>
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              title="No matching transactions found"
              description="Try adjusting your search filters or record a new transaction."
              actionLabel="+ New Transaction"
              onAction={() => {
                setEditingTx(null);
                setIsModalOpen(true);
              }}
            />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Account</th>
                  <th>Category / Target</th>
                  <th>Description & Tags</th>
                  <th className="num">Amount</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((tx) => (
                  <tr
                    key={tx.id}
                    style={tx.deleted_at ? { opacity: 0.65, backgroundColor: '#fef2f2' } : undefined}
                  >
                    <td>{formatDisplayDate(tx.transaction_date, settings.date_format)}</td>
                    <td>
                      <TransactionTypeBadge type={tx.transaction_type} isRefund={tx.is_refund} />
                      {tx.deleted_at && (
                        <span className="badge badge-danger" style={{ marginLeft: '4px' }}>
                          Trashed
                        </span>
                      )}
                    </td>
                    <td>{tx.account_name}</td>
                    <td>
                      {tx.transaction_type === 'transfer' ? (
                        <span>→ {tx.destination_account_name}</span>
                      ) : (
                        <span>{tx.category_name}</span>
                      )}
                    </td>
                    <td>
                      <div>
                        <strong>{tx.description || '—'}</strong>
                      </div>
                      {tx.notes && (
                        <div style={{ fontSize: '11.5px', color: '#6b7280' }}>{tx.notes}</div>
                      )}
                      {tx.tags.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', marginTop: '3px', flexWrap: 'wrap' }}>
                          {tx.tags.map((tag) => (
                            <span
                              key={tag}
                              className="badge badge-neutral"
                              style={{ fontSize: '10.5px', padding: '1px 5px' }}
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      <SignedAmountCell
                        type={tx.transaction_type}
                        amountMinor={tx.amount_minor}
                        currency={tx.currency}
                        isRefund={tx.is_refund}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setViewingTx(tx)}
                        >
                          Details
                        </button>
                        {!tx.deleted_at ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => {
                                setEditingTx(tx);
                                setIsModalOpen(true);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => void handleDuplicate(tx)}
                            >
                              Duplicate
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => setConfirmDeleteTx({ tx, permanent: false })}
                            >
                              Trash
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => void handleRestore(tx)}
                            >
                              Restore
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => setConfirmDeleteTx({ tx, permanent: true })}
                            >
                              Delete Forever
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {data && data.total > 0 && (
          <div className="pagination-bar">
            <span>
              Showing {(data.page - 1) * data.pageSize + 1}–
              {Math.min(data.total, data.page * data.pageSize)} of {data.total} transaction(s)
            </span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={data.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span>
                Page {data.page} of {data.totalPages}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={data.page >= data.totalPages}
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <TransactionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSaved={() => {
          onDataMutated();
          void loadTransactions();
        }}
        accounts={accounts}
        categories={categories}
        editingTransaction={editingTx}
      />

      <Modal
        isOpen={Boolean(viewingTx)}
        title="Transaction Details"
        onClose={() => setViewingTx(null)}
      >
        {viewingTx && (
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: '8px', fontSize: '13px' }}>
            <strong>ID:</strong>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{viewingTx.id}</span>
            <strong>Date:</strong>
            <span>{formatDisplayDate(viewingTx.transaction_date, settings.date_format)}</span>
            <strong>Type:</strong>
            <span>
              <TransactionTypeBadge
                type={viewingTx.transaction_type}
                isRefund={viewingTx.is_refund}
              />
            </span>
            <strong>Amount:</strong>
            <span>
              <SignedAmountCell
                type={viewingTx.transaction_type}
                amountMinor={viewingTx.amount_minor}
                currency={viewingTx.currency}
                isRefund={viewingTx.is_refund}
              />
            </span>
            <strong>Account:</strong>
            <span>{viewingTx.account_name}</span>
            {viewingTx.transaction_type === 'transfer' ? (
              <>
                <strong>Destination:</strong>
                <span>{viewingTx.destination_account_name}</span>
              </>
            ) : (
              <>
                <strong>Category:</strong>
                <span>{viewingTx.category_name}</span>
              </>
            )}
            <strong>Description:</strong>
            <span>{viewingTx.description || '—'}</span>
            <strong>Notes:</strong>
            <span>{viewingTx.notes || '—'}</span>
            <strong>Tags:</strong>
            <span>{viewingTx.tags.length > 0 ? viewingTx.tags.join(', ') : 'None'}</span>
            <strong>Created At:</strong>
            <span>{viewingTx.created_at}</span>
            <strong>Updated At:</strong>
            <span>{viewingTx.updated_at}</span>
            <strong>Record Status:</strong>
            <span>{viewingTx.deleted_at ? `Trashed (${viewingTx.deleted_at})` : 'Active'}</span>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(confirmDeleteTx)}
        title={
          confirmDeleteTx?.permanent
            ? 'Permanently Delete Transaction'
            : 'Move Transaction to Trash'
        }
        message={
          confirmDeleteTx?.permanent
            ? 'This will permanently remove the transaction record from the SQLite database. This action cannot be undone.'
            : 'Moving this transaction to Trash will exclude it from account balances, budgets, and reports until restored.'
        }
        confirmLabel={confirmDeleteTx?.permanent ? 'Delete Forever' : 'Move to Trash'}
        onConfirm={() => void handleConfirmedDelete()}
        onCancel={() => setConfirmDeleteTx(null)}
      />
    </div>
  );
};
