import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../../services/apiClient.js';
import type {
  Account,
  AccountReportItem,
  AppSettings,
  BudgetWithActuals,
  Category,
  CategorySummaryItem,
  MonthlyCashFlowItem,
  PeriodPreset,
  SavingsGoal,
  TransactionRecord,
} from '../../../shared/types/index.js';
import { PERIOD_PRESETS } from '../../../shared/constants/index.js';
import { formatMinorUnits } from '../../../shared/utils/money.js';
import { formatDisplayDate, getTodayIsoDate } from '../../../shared/utils/dates.js';
import { PageHeader } from '../../components/layout/Sidebar.js';
import {
  AlertBanner,
  SignedAmountCell,
  TransactionTypeBadge,
} from '../../components/feedback/Feedback.js';
import {
  CategoryBreakdownBars,
  IncomeExpenseBarChart,
} from '../../components/charts/Charts.js';

interface ReportsViewProps {
  settings: AppSettings;
  accounts: Account[];
  categories: Category[];
  refreshTrigger: number;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  settings,
  accounts,
  categories,
  refreshTrigger,
}) => {
  const [preset, setPreset] = useState<PeriodPreset>('this_year');
  const [customStart, setCustomStart] = useState<string>(getTodayIsoDate().slice(0, 4) + '-01-01');
  const [customEnd, setCustomEnd] = useState<string>(getTodayIsoDate());
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [activeReportTab, setActiveReportTab] = useState<
    'overview' | 'categories' | 'accounts' | 'budgets_goals' | 'history'
  >('overview');

  const [bundle, setBundle] = useState<{
    period: { preset: PeriodPreset; startDate: string; endDate: string };
    currency: string;
    totals: { income_minor: number; expense_minor: number; net_minor: number };
    monthly_cash_flow: MonthlyCashFlowItem[];
    spending_by_category: CategorySummaryItem[];
    income_by_category: CategorySummaryItem[];
    account_report: AccountReportItem[];
    budget_performance: BudgetWithActuals[];
    goals_progress: SavingsGoal[];
    transactions: TransactionRecord[];
  } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getReportBundle({
        preset,
        startDate: preset === 'custom' ? customStart : undefined,
        endDate: preset === 'custom' ? customEnd : undefined,
        accountId: accountFilter || undefined,
        categoryId: categoryFilter || undefined,
      });
      setBundle(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [preset, customStart, customEnd, accountFilter, categoryFilter]);

  useEffect(() => {
    void loadReports();
  }, [loadReports, refreshTrigger]);

  const buildReportCsvUrl = (
    reportType:
      | 'cash_flow'
      | 'spending_by_category'
      | 'income_by_category'
      | 'accounts'
      | 'budgets'
      | 'goals'
  ) => {
    const sp = new URLSearchParams({ reportType, preset });
    if (preset === 'custom') {
      sp.set('startDate', customStart);
      sp.set('endDate', customEnd);
    }
    if (accountFilter) sp.set('accountId', accountFilter);
    if (categoryFilter) sp.set('categoryId', categoryFilter);
    return `/api/reports/export.csv?${sp.toString()}`;
  };

  const currency = bundle?.currency ?? settings.base_currency;

  return (
    <div>
      <PageHeader
        title="Financial Reports"
        description="Auditable tables and charts derived from your local transaction ledger. Export any report as CSV."
        actions={
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <a href={buildReportCsvUrl('cash_flow')} className="btn btn-sm" download>
              Export Cash Flow CSV
            </a>
            <a href={buildReportCsvUrl('spending_by_category')} className="btn btn-sm" download>
              Export Spending CSV
            </a>
            <a href={buildReportCsvUrl('accounts')} className="btn btn-sm" download>
              Export Accounts CSV
            </a>
          </div>
        }
      />

      {error && <AlertBanner type="error" message={error} onDismiss={() => setError(null)} />}

      <div className="panel">
        <div className="filter-bar">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="rep-period">Date Range</label>
            <select
              id="rep-period"
              className="form-control"
              value={preset}
              onChange={(e) => setPreset(e.target.value as PeriodPreset)}
            >
              {PERIOD_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {preset === 'custom' && (
            <>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="rep-start">Start Date</label>
                <input
                  id="rep-start"
                  type="date"
                  className="form-control"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="rep-end">End Date</label>
                <input
                  id="rep-end"
                  type="date"
                  className="form-control"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="rep-account">Filter by Account</label>
            <select
              id="rep-account"
              className="form-control"
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
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
            <label htmlFor="rep-category">Filter by Category</label>
            <select
              id="rep-category"
              className="form-control"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.category_type})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '6px',
            padding: '10px 16px',
            borderBottom: '1px solid var(--border-light)',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className={`btn btn-sm ${activeReportTab === 'overview' ? 'btn-primary' : ''}`}
            onClick={() => setActiveReportTab('overview')}
          >
            1. Monthly Cash Flow & Income vs Expenses
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeReportTab === 'categories' ? 'btn-primary' : ''}`}
            onClick={() => setActiveReportTab('categories')}
          >
            2. Spending & Income by Category
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeReportTab === 'accounts' ? 'btn-primary' : ''}`}
            onClick={() => setActiveReportTab('accounts')}
          >
            3. Activity by Account
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeReportTab === 'budgets_goals' ? 'btn-primary' : ''}`}
            onClick={() => setActiveReportTab('budgets_goals')}
          >
            4. Budget Performance & Savings Goals
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeReportTab === 'history' ? 'btn-primary' : ''}`}
            onClick={() => setActiveReportTab('history')}
          >
            5. Period Transaction Audit ({bundle?.transactions.length ?? 0})
          </button>
        </div>
      </div>

      {loading && !bundle ? (
        <div className="panel">
          <div className="panel-body">Computing financial reports...</div>
        </div>
      ) : bundle ? (
        <>
          <div className="kpi-grid">
            <div className="kpi-box">
              <div className="kpi-label">Report Period</div>
              <div className="kpi-value" style={{ fontSize: '16px' }}>
                {formatDisplayDate(bundle.period.startDate, settings.date_format)} —{' '}
                {formatDisplayDate(bundle.period.endDate, settings.date_format)}
              </div>
              <div className="kpi-sub">{bundle.transactions.length} matching ledger entries</div>
            </div>
            <div className="kpi-box">
              <div className="kpi-label">Total Income</div>
              <div className="kpi-value amount-positive">
                +{formatMinorUnits(bundle.totals.income_minor, currency)}
              </div>
            </div>
            <div className="kpi-box">
              <div className="kpi-label">Total Net Expenses</div>
              <div className="kpi-value amount-negative">
                -{formatMinorUnits(bundle.totals.expense_minor, currency)}
              </div>
            </div>
            <div className="kpi-box">
              <div className="kpi-label">Net Cash Flow</div>
              <div
                className={`kpi-value ${
                  bundle.totals.net_minor >= 0 ? 'amount-positive' : 'amount-negative'
                }`}
              >
                {formatMinorUnits(bundle.totals.net_minor, currency, {
                  showExplicitSign: true,
                })}
              </div>
            </div>
          </div>

          {activeReportTab === 'overview' && (
            <div className="grid-2">
              <section className="panel">
                <div className="panel-header">
                  <h3 className="panel-title">Monthly Income vs. Expenses Chart</h3>
                </div>
                <div className="panel-body">
                  <IncomeExpenseBarChart
                    series={bundle.monthly_cash_flow}
                    currency={currency}
                  />
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <h3 className="panel-title">Monthly Cash Flow Table</h3>
                  <a href={buildReportCsvUrl('cash_flow')} className="btn btn-sm" download>
                    CSV
                  </a>
                </div>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th className="num">Income (+)</th>
                        <th className="num">Expenses (-)</th>
                        <th className="num">Net Cash Flow</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.monthly_cash_flow.length === 0 ? (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', padding: '16px' }}>
                            No monthly cash flow records in this period.
                          </td>
                        </tr>
                      ) : (
                        bundle.monthly_cash_flow.map((m) => (
                          <tr key={m.month}>
                            <td>
                              <strong>{m.month}</strong>
                            </td>
                            <td className="num amount-positive">
                              +{formatMinorUnits(m.income_minor, currency)}
                            </td>
                            <td className="num amount-negative">
                              -{formatMinorUnits(m.expense_minor, currency)}
                            </td>
                            <td
                              className={`num ${
                                m.net_minor >= 0 ? 'amount-positive' : 'amount-negative'
                              }`}
                            >
                              {formatMinorUnits(m.net_minor, currency, {
                                showExplicitSign: true,
                              })}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {activeReportTab === 'categories' && (
            <div className="grid-2">
              <section className="panel">
                <div className="panel-header">
                  <h3 className="panel-title">Spending by Category</h3>
                  <a
                    href={buildReportCsvUrl('spending_by_category')}
                    className="btn btn-sm"
                    download
                  >
                    CSV
                  </a>
                </div>
                <div className="panel-body">
                  <CategoryBreakdownBars
                    items={bundle.spending_by_category}
                    currency={currency}
                  />
                </div>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Expense Category</th>
                        <th className="num">Transactions</th>
                        <th className="num">Net Amount</th>
                        <th className="num">Share (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.spending_by_category.map((c) => (
                        <tr key={c.category_id}>
                          <td>{c.category_name}</td>
                          <td className="num">{c.transaction_count}</td>
                          <td className="num">{formatMinorUnits(c.amount_minor, currency)}</td>
                          <td className="num">{c.percentage}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <h3 className="panel-title">Income by Category</h3>
                  <a
                    href={buildReportCsvUrl('income_by_category')}
                    className="btn btn-sm"
                    download
                  >
                    CSV
                  </a>
                </div>
                <div className="panel-body">
                  <CategoryBreakdownBars
                    items={bundle.income_by_category}
                    currency={currency}
                  />
                </div>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Income Category</th>
                        <th className="num">Transactions</th>
                        <th className="num">Amount</th>
                        <th className="num">Share (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.income_by_category.map((c) => (
                        <tr key={c.category_id}>
                          <td>{c.category_name}</td>
                          <td className="num">{c.transaction_count}</td>
                          <td className="num amount-positive">
                            {formatMinorUnits(c.amount_minor, currency)}
                          </td>
                          <td className="num">{c.percentage}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {activeReportTab === 'accounts' && (
            <section className="panel">
              <div className="panel-header">
                <h3 className="panel-title">Spending & Movement by Account</h3>
                <a href={buildReportCsvUrl('accounts')} className="btn btn-sm" download>
                  Export CSV
                </a>
              </div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Type</th>
                      <th className="num">Opening Balance</th>
                      <th className="num">Period Income</th>
                      <th className="num">Period Expense</th>
                      <th className="num">Transfers In</th>
                      <th className="num">Transfers Out</th>
                      <th className="num">Period Net</th>
                      <th className="num">Current Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundle.account_report.map((a) => (
                      <tr key={a.account_id}>
                        <td>
                          <strong>{a.account_name}</strong>
                        </td>
                        <td>{a.account_type}</td>
                        <td className="num">
                          {formatMinorUnits(a.opening_balance_minor, currency)}
                        </td>
                        <td className="num amount-positive">
                          +{formatMinorUnits(a.period_income_minor, currency)}
                        </td>
                        <td className="num amount-negative">
                          -{formatMinorUnits(a.period_expense_minor, currency)}
                        </td>
                        <td className="num">
                          +{formatMinorUnits(a.period_transfer_in_minor, currency)}
                        </td>
                        <td className="num">
                          -{formatMinorUnits(a.period_transfer_out_minor, currency)}
                        </td>
                        <td
                          className={`num ${
                            a.period_net_minor >= 0 ? 'amount-positive' : 'amount-negative'
                          }`}
                        >
                          {formatMinorUnits(a.period_net_minor, currency, {
                            showExplicitSign: true,
                          })}
                        </td>
                        <td className="num">
                          <strong>{formatMinorUnits(a.current_balance_minor, currency)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeReportTab === 'budgets_goals' && (
            <div className="grid-2">
              <section className="panel">
                <div className="panel-header">
                  <h3 className="panel-title">Budget Performance Summary</h3>
                  <a href={buildReportCsvUrl('budgets')} className="btn btn-sm" download>
                    CSV
                  </a>
                </div>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Budget</th>
                        <th className="num">Planned</th>
                        <th className="num">Actual</th>
                        <th className="num">Remaining</th>
                        <th className="num">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.budget_performance.map((b) => (
                        <tr key={b.id}>
                          <td>{b.period_month}</td>
                          <td>
                            <strong>{b.name}</strong> ({b.category_name})
                          </td>
                          <td className="num">
                            {formatMinorUnits(b.planned_amount_minor, currency)}
                          </td>
                          <td className="num">{formatMinorUnits(b.actual_minor, currency)}</td>
                          <td
                            className={`num ${
                              b.remaining_minor < 0 ? 'amount-negative' : 'amount-positive'
                            }`}
                          >
                            {formatMinorUnits(b.remaining_minor, currency)}
                          </td>
                          <td className="num">{b.percentage_used}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <h3 className="panel-title">Savings Goal Progress Report</h3>
                  <a href={buildReportCsvUrl('goals')} className="btn btn-sm" download>
                    CSV
                  </a>
                </div>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Goal</th>
                        <th>Status</th>
                        <th className="num">Saved</th>
                        <th className="num">Target</th>
                        <th className="num">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.goals_progress.map((g) => (
                        <tr key={g.id}>
                          <td>
                            <strong>{g.name}</strong>
                          </td>
                          <td>{g.status}</td>
                          <td className="num amount-positive">
                            {formatMinorUnits(g.current_amount_minor, currency)}
                          </td>
                          <td className="num">
                            {formatMinorUnits(g.target_amount_minor, currency)}
                          </td>
                          <td className="num">{g.percentage_achieved}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {activeReportTab === 'history' && (
            <section className="panel">
              <div className="panel-header">
                <h3 className="panel-title">
                  Auditable Transaction History ({bundle.transactions.length})
                </h3>
                <a
                  href={`/api/export/transactions.csv?startDate=${bundle.period.startDate}&endDate=${bundle.period.endDate}`}
                  className="btn btn-sm"
                  download
                >
                  Export Period Transactions CSV
                </a>
              </div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Account</th>
                      <th>Category / Target</th>
                      <th>Description</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundle.transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td>{formatDisplayDate(tx.transaction_date, settings.date_format)}</td>
                        <td>
                          <TransactionTypeBadge
                            type={tx.transaction_type}
                            isRefund={tx.is_refund}
                          />
                        </td>
                        <td>{tx.account_name}</td>
                        <td>
                          {tx.transaction_type === 'transfer'
                            ? `→ ${tx.destination_account_name}`
                            : tx.category_name}
                        </td>
                        <td>{tx.description || '—'}</td>
                        <td className="num">
                          <SignedAmountCell
                            type={tx.transaction_type}
                            amountMinor={tx.amount_minor}
                            currency={tx.currency}
                            isRefund={tx.is_refund}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
};
