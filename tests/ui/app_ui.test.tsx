// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { App } from '../../src/client/app/App.js';

describe('LedgerDesk UI & User Flows', () => {
  const mockAccounts = [
    {
      id: 'acc-1',
      name: 'Main Checking',
      account_type: 'current',
      opening_balance_minor: 100000,
      current_balance_minor: 138000,
      inflow_minor: 50000,
      outflow_minor: 12000,
      net_movement_minor: 38000,
      transaction_count: 2,
      currency: 'USD',
      description: 'Primary account',
      status: 'active',
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    },
  ];

  const mockCategories = [
    {
      id: 'cat-exp-groceries',
      name: 'Groceries',
      category_type: 'expense',
      parent_id: null,
      display_order: 1,
      is_archived: false,
      transaction_count: 1,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'cat-inc-salary',
      name: 'Salary',
      category_type: 'income',
      parent_id: null,
      display_order: 1,
      is_archived: false,
      transaction_count: 1,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    },
  ];

  const mockTransactions = [
    {
      id: 'tx-1',
      transaction_type: 'expense',
      transaction_date: '2026-10-15',
      amount_minor: 12000,
      currency: 'USD',
      account_id: 'acc-1',
      account_name: 'Main Checking',
      destination_account_id: null,
      destination_account_name: null,
      category_id: 'cat-exp-groceries',
      category_name: 'Groceries',
      category_type: 'expense',
      description: 'Fresh Market',
      notes: 'Weekly groceries',
      tags: ['food'],
      is_refund: false,
      refunded_transaction_id: null,
      import_batch_id: null,
      import_external_id: null,
      created_at: '2026-10-15T10:00:00.000Z',
      updated_at: '2026-10-15T10:00:00.000Z',
      deleted_at: null,
    },
  ];

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';

        const jsonResponse = (data: unknown, status = 200) =>
          new Response(JSON.stringify({ data }), {
            status,
            headers: { 'Content-Type': 'application/json' },
          });

        if (url.startsWith('/api/settings')) {
          return jsonResponse({
            base_currency: 'USD',
            date_format: 'YYYY-MM-DD',
            default_period: 'this_month',
          });
        }

        if (url.startsWith('/api/accounts') && method === 'GET') {
          return jsonResponse(mockAccounts);
        }

        if (url.startsWith('/api/categories') && method === 'GET') {
          return jsonResponse(mockCategories);
        }

        if (url.startsWith('/api/dashboard')) {
          return jsonResponse({
            period: { preset: 'this_month', startDate: '2026-10-01', endDate: '2026-10-31' },
            currency: 'USD',
            total_balance_minor: 138000,
            active_accounts_count: 1,
            period_income_minor: 50000,
            period_expense_minor: 12000,
            net_cash_flow_minor: 38000,
            budgets_summary: {
              month: '2026-10',
              total_planned_minor: 40000,
              total_actual_minor: 12000,
              items: [],
            },
            upcoming_occurrences: [],
            goals_summary: [],
            recent_transactions: mockTransactions,
            cash_flow_series: [
              { month: '2026-10', income_minor: 50000, expense_minor: 12000, net_minor: 38000 },
            ],
            spending_by_category: [
              {
                category_id: 'cat-exp-groceries',
                category_name: 'Groceries',
                category_type: 'expense',
                amount_minor: 12000,
                percentage: 100,
                transaction_count: 1,
              },
            ],
          });
        }

        if (url.startsWith('/api/transactions') && method === 'GET') {
          return jsonResponse({
            items: mockTransactions,
            total: 1,
            page: 1,
            pageSize: 25,
            totalPages: 1,
          });
        }

        if (url.startsWith('/api/transactions') && method === 'POST') {
          return jsonResponse(mockTransactions[0], 201);
        }

        if (url.startsWith('/api/budgets') && method === 'GET') {
          return jsonResponse([]);
        }

        if (url.startsWith('/api/recurring') && method === 'GET') {
          return jsonResponse({ rules: [], occurrences: [] });
        }

        if (url.startsWith('/api/goals') && method === 'GET') {
          return jsonResponse([]);
        }

        if (url.startsWith('/api/backup') && method === 'GET') {
          return jsonResponse([]);
        }

        return jsonResponse({});
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the Dashboard with real ledger balances and navigates across modules', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Financial Dashboard')).toBeInTheDocument();
      expect(screen.getByText('$1,380.00')).toBeInTheDocument();
    });

    // Navigate to Transactions
    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }));
    await waitFor(() => {
      expect(screen.getByText('Transactions Ledger')).toBeInTheDocument();
      expect(screen.getByText('Fresh Market')).toBeInTheDocument();
    });

    // Open confirmation dialog when clicking Trash
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }));
    expect(screen.getByText('Move Transaction to Trash')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Navigate to Accounts
    fireEvent.click(screen.getByRole('button', { name: 'Accounts' }));
    await waitFor(() => {
      expect(screen.getByText('Combined Active Balance')).toBeInTheDocument();
      expect(screen.getByText('Main Checking')).toBeInTheDocument();
    });

    // Navigate to Budgets (verifies empty state behavior)
    fireEvent.click(screen.getByRole('button', { name: 'Budgets' }));
    await waitFor(() => {
      expect(screen.getByText('Monthly Budgets')).toBeInTheDocument();
      expect(screen.getByText(/No budgets defined for/i)).toBeInTheDocument();
    });

    // Navigate to Settings (verifies export actions and backup controls)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await waitFor(() => {
      expect(
        screen.getByText('Application Settings & Data Management')
      ).toBeInTheDocument();
      expect(screen.getByText('Download Transactions (CSV)')).toBeInTheDocument();
      expect(
        screen.getByText('Download Full Structured Archive (JSON)')
      ).toBeInTheDocument();
    });
  });

  it('validates monetary input in the Record Transaction modal and displays error feedback', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Financial Dashboard')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '+ Record Transaction' }));
    expect(screen.getByRole('dialog', { name: 'Record Transaction' })).toBeInTheDocument();

    const amountInput = screen.getByLabelText('Amount');
    fireEvent.change(amountInput, { target: { value: '12.345' } }); // Invalid >2 decimals
    fireEvent.submit(document.getElementById('transaction-form')!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Invalid monetary amount format/i);
    });
  });
});
